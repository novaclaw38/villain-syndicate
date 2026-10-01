-- Villain Syndicate: remove the 5-attacks-per-hour limit, and make failed attacks
-- cost the attacker XP that goes to the defender.
-- Players below 20 health still can't be attacked, so nobody gets farmed while knocked out.

create or replace function public.vs_targets(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  me villain.players;
  mp record;
begin
  me := villain._tick(pid);
  select * into mp from villain._power(pid, me.atk, me.def, me.hench);
  return coalesce((
    select jsonb_agg(t order by t.dist, t.level desc) from (
      select o.id, o.name, o.arch, o.level, o.hench + 1 as crew,
             abs(o.level - me.level) as dist,
             o.last_seen > now() - interval '5 minutes' as online,
             (select coalesce(sum(b.amount), 0) from villain.bounties b where b.target_id = o.id and b.claimed_at is null) as bounty,
             round((mp.o_atk::numeric / greatest(1, (select pw.o_def from villain._power(o.id, o.atk, o.def, o.hench) pw))), 2) as ratio,
             least(o.max_hp, o.hp + floor(extract(epoch from now() - o.t_hp) / 10)::int * greatest(1, round(o.max_hp / 60.0))::int) as hp_now,
             o.max_hp
        from villain.players o
       where o.id <> pid
       order by abs(o.level - me.level), o.last_seen desc
       limit 15
    ) t), '[]'::jsonb);
end $$;

create or replace function public.vs_attack(p_token text, p_target bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  a villain.players; d villain.players;
  pa record; pd record;
  prob float8;
  stolen bigint; base bigint; xp int; dmg_a int; dmg_d int; bsum bigint := 0;
  msg text; kind text; xp_swing int; lost_xp int;
begin
  if pid = p_target then raise exception 'You can''t attack yourself.'; end if;
  if not exists (select 1 from villain.players where id = p_target) then raise exception 'That villain no longer exists.'; end if;
  -- lock both rows in id order to avoid deadlocks
  if pid < p_target then a := villain._tick(pid); d := villain._tick(p_target);
  else d := villain._tick(p_target); a := villain._tick(pid); end if;

  if a.level < 3 then raise exception 'Reach level 3 to attack other villains. Fight street goons until then.'; end if;
  if d.level < 3 then raise exception '% is still under newcomer protection until level 3.', d.name; end if;
  if a.st < 1 then raise exception 'Not enough stamina.'; end if;
  if a.hp < 20 then raise exception 'You are too hurt to fight. Heal in the regen tank first.'; end if;
  if d.hp < 20 then raise exception '% is already beaten up and recovering. Try again later.', d.name; end if;

  select * into pa from villain._power(a.id, a.atk, a.def, a.hench);
  select * into pd from villain._power(d.id, d.atk, d.def, d.hench);
  prob := greatest(0.05, least(0.95, pa.o_atk::float8 ^ 2 / (pa.o_atk::float8 ^ 2 + pd.o_def::float8 ^ 2)));
  a.st := a.st - 1;
  insert into villain.fights (attacker, defender) values (a.id, d.id);

  if random() < prob then
    stolen := floor(d.cash * case when a.arch = 'brute' then 0.115 else 0.10 end);
    stolen := least(stolen, d.cash);
    base := 10 * d.level;
    xp := greatest(1, least(15, 3 + (d.level - a.level)));
    dmg_a := villain._rint(2, 8);
    dmg_d := villain._rint(10, 25);
    a.cash := a.cash + stolen + base; a.earned := a.earned + stolen + base;
    d.cash := d.cash - stolen;
    a.hp := greatest(0, a.hp - dmg_a); d.hp := greatest(0, d.hp - dmg_d);
    a.pvp_wins := a.pvp_wins + 1; d.pvp_losses := d.pvp_losses + 1;
    msg := format('You beat %s: took %s, +%s XP, lost %s health.', d.name, villain._usd(stolen + base), xp, dmg_a);
    kind := 'win';
    perform villain._log(d.id, 'loss', format('%s attacked you and took %s in cash. You lost %s health. Bank your cash to keep it safe.', a.name, villain._usd(stolen), dmg_d));

    -- knocking a target out collects every open bounty on them (except your own)
    if d.hp < 20 then
      select coalesce(sum(amount), 0) into bsum from villain.bounties
       where target_id = d.id and claimed_at is null and placed_by is distinct from a.id;
      if bsum > 0 then
        update villain.bounties set claimed_by = a.id, claimed_at = now()
         where target_id = d.id and claimed_at is null and placed_by is distinct from a.id;
        a.cash := a.cash + bsum; a.earned := a.earned + bsum;
        msg := msg || format(' You knocked them out and collected a %s bounty!', villain._usd(bsum));
        perform villain._wire(format('%s knocked out %s and collected a %s bounty.', a.name, d.name, villain._usd(bsum)));
      end if;
    end if;
    perform villain._log(a.id, kind, msg);
    a := villain._add_xp(a, xp);
  else
    dmg_a := villain._rint(8, 18);
    dmg_d := villain._rint(1, 6);
    stolen := round(a.cash * 0.05);
    a.cash := a.cash - stolen; d.cash := d.cash + stolen;
    a.hp := greatest(0, a.hp - dmg_a); d.hp := greatest(0, d.hp - dmg_d);
    a.pvp_losses := a.pvp_losses + 1; d.pvp_wins := d.pvp_wins + 1;
    -- a failed attack costs the attacker XP and pays it to the defender
    -- (more when a higher-level villain picks on a lower one); nobody drops a level
    xp_swing := greatest(2, least(15, 2 + (a.level - d.level)));
    lost_xp := least(a.xp, xp_swing);
    a.xp := a.xp - lost_xp;
    msg := format('%s beat you: you dropped %s, lost %s health and %s XP.', d.name, villain._usd(stolen), dmg_a, lost_xp);
    kind := 'loss';
    perform villain._log(a.id, kind, msg);
    perform villain._log(d.id, 'win', format('%s attacked you and lost. Your defenses held: +%s XP and you picked up %s they dropped.', a.name, xp_swing, villain._usd(stolen)));
    d := villain._add_xp(d, xp_swing);
  end if;
  perform villain._save(a);
  perform villain._save(d);
  return jsonb_build_object('msg', msg, 'kind', kind, 'state', villain._state(pid));
end $$;
