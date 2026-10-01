-- Villain Syndicate: public API. Every client action is one of these functions.
-- They run as the owner (security definer) and check every rule on the server.

-- ---------- Catalog and accounts ----------
create or replace function public.vs_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'archs', (select jsonb_agg(to_jsonb(a) order by a.ord) from villain.cat_archs a),
    'items', (select jsonb_agg(to_jsonb(i) order by i.ord) from villain.cat_items i),
    'districts', (select jsonb_agg(to_jsonb(d) order by d.ord) from villain.cat_districts d),
    'schemes', (select jsonb_agg(to_jsonb(s) order by s.district, s.ord) from villain.cat_schemes s),
    'props', (select jsonb_agg(to_jsonb(p) order by p.ord) from villain.cat_props p),
    'heroes', (select jsonb_agg(to_jsonb(h) order by h.ord) from villain.cat_heroes h)
  )
$$;

create or replace function villain._new_session(pid bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  delete from villain.sessions where expires_at < now();
  insert into villain.sessions (token, player_id, expires_at) values (tok, pid, now() + interval '30 days');
  return tok;
end $$;
revoke all on function villain._new_session(bigint) from public, anon, authenticated;

create or replace function public.vs_register(p_username text, p_password text, p_name text, p_arch text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u text := lower(trim(coalesce(p_username, '')));
  n text := trim(regexp_replace(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'), '\s+', ' ', 'g'));
  a villain.cat_archs;
  pid bigint;
begin
  if u !~ '^[a-z0-9_]{3,20}$' then raise exception 'Usernames are 3 to 20 letters, numbers or underscores.'; end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'Use a password of at least 6 characters.'; end if;
  if length(n) < 2 or length(n) > 24 then raise exception 'Villain names are 2 to 24 characters.'; end if;
  select * into a from villain.cat_archs where id = p_arch;
  if not found then raise exception 'Pick a style: Mastermind, Brute or Shadow.'; end if;
  if exists (select 1 from villain.players where username = u) then raise exception 'That username is taken.'; end if;
  if exists (select 1 from villain.players where lower(name) = lower(n)) then raise exception 'Another villain already goes by that name.'; end if;

  insert into villain.players (username, pass_hash, name, arch, cash, hp, max_hp, en, max_en, st, max_st, atk, def)
  values (u, extensions.crypt(p_password, extensions.gen_salt('bf', 8)), n, a.id, a.cash,
          a.hp, a.hp, a.en, a.en, a.st, a.st, a.atk, a.def)
  returning id into pid;

  perform villain._log(pid, 'lvl', format('%s the %s has entered the underworld. Start small at the Rustwater Docks.', n, a.name));
  perform villain._wire(format('%s the %s has entered the underworld.', n, a.name));
  return jsonb_build_object('token', villain._new_session(pid), 'state', villain._state(pid));
end $$;

-- Returns {error} instead of raising, so the failed-attempt counter is kept.
create or replace function public.vs_login(p_username text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  u text := lower(trim(coalesce(p_username, '')));
  lf villain.login_fails;
  p villain.players;
begin
  select * into lf from villain.login_fails where username = u;
  if found and lf.fails >= 10 and lf.last_fail > now() - interval '15 minutes' then
    return jsonb_build_object('error', 'Too many failed sign-ins. Wait 15 minutes and try again.');
  end if;
  select * into p from villain.players where username = u;
  if not found or p.pass_hash <> extensions.crypt(coalesce(p_password, ''), p.pass_hash) then
    insert into villain.login_fails (username, fails, last_fail) values (u, 1, now())
    on conflict (username) do update set
      fails = case when villain.login_fails.last_fail < now() - interval '15 minutes' then 1 else villain.login_fails.fails + 1 end,
      last_fail = now();
    return jsonb_build_object('error', 'Wrong username or password.');
  end if;
  delete from villain.login_fails where username = u;
  perform villain._tick(p.id);
  return jsonb_build_object('token', villain._new_session(p.id), 'state', villain._state(p.id));
end $$;

create or replace function public.vs_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from villain.sessions where token = p_token;
$$;

create or replace function public.vs_state(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token);
begin
  perform villain._tick(pid);
  return villain._state(pid);
end $$;

create or replace function public.vs_delete_account(p_token text, p_password text) returns void
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players;
begin
  select * into p from villain.players where id = pid;
  if p.pass_hash <> extensions.crypt(coalesce(p_password, ''), p.pass_hash) then
    raise exception 'That password is wrong.';
  end if;
  perform villain._wire(format('%s has retired from villainy.', p.name));
  delete from villain.players where id = pid;
end $$;

-- ---------- Schemes ----------
create or replace function public.vs_scheme(p_token text, p_scheme text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  p villain.players;
  s villain.cat_schemes;
  d villain.cat_districts;
  r record;
  cash bigint;
  prev int;
  m int;
  msg text;
begin
  p := villain._tick(pid);
  select * into s from villain.cat_schemes where id = p_scheme;
  if not found then raise exception 'Unknown scheme.'; end if;
  select * into d from villain.cat_districts where id = s.district;
  if p.level < d.lvl then raise exception 'Reach level % to work in %.', d.lvl, d.name; end if;
  if p.en < s.energy then raise exception 'Not enough energy.'; end if;
  for r in select key, value::int as v from jsonb_each_text(s.req) loop
    if r.key = 'h' then
      if p.hench < r.v then raise exception 'You need % henchmen for this scheme.', r.v; end if;
    elsif villain._owned(pid, r.key) < r.v then
      raise exception 'You need %× % for this scheme.', r.v, (select name from villain.cat_items where id = r.key);
    end if;
  end loop;

  p.en := p.en - s.energy;
  cash := villain._rint(s.cash_min, s.cash_max);
  if p.arch = 'mastermind' then cash := round(cash * 1.1); end if;
  p.cash := p.cash + cash;
  p.earned := p.earned + cash;
  p.schemes := p.schemes + 1;

  prev := coalesce((select pct from villain.mastery where player_id = pid and scheme = s.id), 0);
  insert into villain.mastery (player_id, scheme, pct) values (pid, s.id, 10)
  on conflict (player_id, scheme) do update set pct = least(100, villain.mastery.pct + 10)
  returning pct into m;

  msg := format('%s paid %s and %s XP.', s.name, villain._usd(cash), s.xp);
  if prev < 100 and m >= 100 then msg := msg || ' Scheme mastered.'; end if;
  perform villain._log(pid, 'win', msg);

  if not exists (select 1 from villain.districts_done where player_id = pid and district = d.id)
     and not exists (select 1 from villain.cat_schemes cs
                      where cs.district = d.id
                        and coalesce((select mm.pct from villain.mastery mm where mm.player_id = pid and mm.scheme = cs.id), 0) < 100) then
    insert into villain.districts_done values (pid, d.id);
    perform villain._add_item(pid, d.reward, 1);
    p.sp := p.sp + 3;
    msg := msg || format(' You took control of %s: %s and 3 skill points.', d.name, (select name from villain.cat_items where id = d.reward));
    perform villain._log(pid, 'lvl', format('You own %s. Reward: %s and 3 skill points.', d.name, (select name from villain.cat_items where id = d.reward)));
    perform villain._wire(format('%s took control of %s.', p.name, d.name));
  end if;

  p := villain._add_xp(p, s.xp);
  perform villain._save(p);
  return jsonb_build_object('msg', msg, 'kind', 'win', 'state', villain._state(pid));
end $$;

-- ---------- Fights ----------
-- Street goons: computer opponents. Difficulty sets their defense relative to your attack.
create or replace function public.vs_fight_goon(p_token text, p_diff text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  p villain.players;
  pw record;
  lo float8; hi float8; bonus int;
  opp_def float8; prob float8;
  nm text := left(trim(regexp_replace(coalesce(p_name, ''), '[^A-Za-z .''-]', '', 'g')), 40);
  cash bigint; xp int; dmg int; lost bigint; msg text; kind text;
begin
  p := villain._tick(pid);
  if nm = '' then nm := 'a street goon'; end if;
  case p_diff
    when 'easy' then lo := 0.55; hi := 0.85; bonus := 0;
    when 'even' then lo := 0.85; hi := 1.15; bonus := 1;
    when 'risky' then lo := 1.15; hi := 1.40; bonus := 2;
    else raise exception 'Unknown difficulty.';
  end case;
  if p.st < 1 then raise exception 'Not enough stamina.'; end if;
  if p.hp < 20 then raise exception 'You are too hurt to fight. Heal in the regen tank first.'; end if;

  select * into pw from villain._power(pid, p.atk, p.def, p.hench);
  opp_def := pw.o_atk * (lo + random() * (hi - lo));
  prob := greatest(0.05, least(0.95, pw.o_atk::float8 ^ 2 / (pw.o_atk::float8 ^ 2 + opp_def ^ 2)));
  p.st := p.st - 1;

  if random() < prob then
    cash := villain._rint(20, 60) * (p.level + bonus) + villain._rint(0, 40);
    if p.arch = 'brute' then cash := round(cash * 1.15); end if;
    xp := villain._rint(2, 5) + bonus;
    dmg := villain._rint(2, 8);
    p.hp := greatest(0, p.hp - dmg);
    p.cash := p.cash + cash; p.earned := p.earned + cash; p.wins := p.wins + 1;
    msg := format('You beat %s: took %s, +%s XP, lost %s health.', nm, villain._usd(cash), xp, dmg);
    kind := 'win';
    perform villain._log(pid, kind, msg);
    p := villain._add_xp(p, xp);
  else
    dmg := villain._rint(8, 18);
    lost := round(p.cash * 0.05);
    p.hp := greatest(0, p.hp - dmg); p.cash := p.cash - lost; p.losses := p.losses + 1;
    msg := format('%s beat you: you dropped %s and lost %s health.', nm, villain._usd(lost), dmg);
    kind := 'loss';
    perform villain._log(pid, kind, msg);
  end if;
  perform villain._save(p);
  return jsonb_build_object('msg', msg, 'kind', kind, 'state', villain._state(pid));
end $$;

-- Real players you can attack, closest in level first.
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
             o.max_hp,
             (select count(*) from villain.fights f where f.attacker = pid and f.defender = o.id and f.created_at > now() - interval '1 hour') as hits
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
  msg text; kind text;
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
  if (select count(*) from villain.fights where attacker = pid and defender = d.id and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You''ve hit % five times this hour. Find another target.', d.name;
  end if;

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
    msg := format('%s beat you: you dropped %s and lost %s health.', d.name, villain._usd(stolen), dmg_a);
    kind := 'loss';
    perform villain._log(a.id, kind, msg);
    perform villain._log(d.id, 'win', format('%s attacked you and lost. You picked up %s they dropped.', a.name, villain._usd(stolen)));
    d := villain._add_xp(d, 1);
  end if;
  perform villain._save(a);
  perform villain._save(d);
  return jsonb_build_object('msg', msg, 'kind', kind, 'state', villain._state(pid));
end $$;

create or replace function public.vs_bounty(p_token text, p_target bigint, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  p villain.players; t villain.players;
  minimum bigint;
  msg text;
begin
  if pid = p_target then raise exception 'You can''t put a bounty on yourself.'; end if;
  p := villain._tick(pid);
  select * into t from villain.players where id = p_target;
  if not found then raise exception 'That villain no longer exists.'; end if;
  minimum := 500 * t.level;
  if coalesce(p_amount, 0) < minimum then raise exception 'A bounty on % must be at least %.', t.name, villain._usd(minimum); end if;
  if p_amount > p.cash then raise exception 'You don''t have that much cash on hand.'; end if;
  p.cash := p.cash - p_amount;
  insert into villain.bounties (target_id, placed_by, amount) values (t.id, pid, p_amount);
  perform villain._save(p);
  msg := format('You put a %s bounty on %s.', villain._usd(p_amount), t.name);
  perform villain._log(pid, '', msg);
  perform villain._log(t.id, 'loss', format('%s put a %s bounty on your head. Whoever knocks you out collects it.', p.name, villain._usd(p_amount)));
  perform villain._wire(format('%s put a %s bounty on %s.', p.name, villain._usd(p_amount), t.name));
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_heal(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; c bigint; msg text;
begin
  p := villain._tick(pid);
  if p.hp >= p.max_hp then raise exception 'You are already at full health.'; end if;
  c := ceil((p.max_hp - p.hp) * (2 + p.level * 1.5));
  if p.cash < c then raise exception 'The regen tank costs % right now.', villain._usd(c); end if;
  p.cash := p.cash - c; p.hp := p.max_hp; p.t_hp := now();
  msg := format('Spent %s in the regen tank. Health full.', villain._usd(c));
  perform villain._log(pid, '', msg);
  perform villain._save(p);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

-- ---------- Heroes (shared world bosses) ----------
create or replace function public.vs_strike(p_token text, p_hero text, p_times int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  pid bigint := villain._auth(p_token);
  p villain.players;
  h villain.cat_heroes;
  hs villain.heroes;
  pw record;
  times int := least(greatest(coalesce(p_times, 1), 1), 5);
  hits int := 0; dealt bigint := 0; taken int := 0; dmg bigint; back int;
  scale float8; pool_cash bigint; pool_xp bigint; total bigint; top_id bigint;
  r record; c bigint; x int; share float8;
  msg text; kind text := '';
begin
  p := villain._tick(pid);
  select * into h from villain.cat_heroes where id = p_hero;
  if not found then raise exception 'Unknown hero.'; end if;
  if p.level < h.lvl then raise exception '% only fights villains of level % and up.', h.name, h.lvl; end if;
  select * into hs from villain.heroes where id = p_hero for update;
  select * into pw from villain._power(pid, p.atk, p.def, p.hench);

  while times > 0 and p.st >= 1 and p.hp >= 10 and hs.hp > 0 loop
    times := times - 1; hits := hits + 1; p.st := p.st - 1;
    dmg := round(pw.o_atk * (0.8 + random() * 0.4));
    hs.hp := greatest(0, hs.hp - dmg); dealt := dealt + dmg;
    back := greatest(1, round(h.atk * (1 + hs.defeats * 0.25) * (0.4 + random() * 0.4) - pw.o_def * 0.08))::int;
    p.hp := greatest(0, p.hp - back); taken := taken + back;
  end loop;
  if hits = 0 then
    if p.hp < 10 then raise exception 'Too hurt to fight a hero. Heal in the regen tank first.'; end if;
    raise exception 'Not enough stamina.';
  end if;

  insert into villain.hero_damage (hero_id, player_id, dmg) values (h.id, pid, dealt)
  on conflict (hero_id, player_id) do update set dmg = villain.hero_damage.dmg + excluded.dmg;
  perform villain._save(p);
  msg := format('You hit %s for %s. They hit back for %s.', h.name, to_char(dealt, 'FM999,999,999,990'), taken);

  if hs.hp <= 0 then
    scale := 1 + hs.defeats * 0.25;
    pool_cash := round(villain._rint(h.cash_min, h.cash_max) * scale);
    pool_xp := round(h.xp * scale);
    select sum(hd.dmg) into total from villain.hero_damage hd where hd.hero_id = h.id;
    select hd.player_id into top_id from villain.hero_damage hd where hd.hero_id = h.id order by hd.dmg desc limit 1;
    for r in select hd.player_id, hd.dmg from villain.hero_damage hd where hd.hero_id = h.id loop
      share := r.dmg::float8 / greatest(total, 1);
      c := round(pool_cash * share);
      x := greatest(1, round(pool_xp * share))::int;
      perform villain._hero_payout(r.player_id, c, x,
        format('%s has fallen! You dealt %s%% of the damage and earned %s and %s XP.', h.name, round(share * 100), villain._usd(c), x));
    end loop;
    perform villain._add_item(pid, h.loot, 1);
    if top_id is not null and top_id <> pid then perform villain._add_item(top_id, h.loot, 1); end if;
    perform villain._log(pid, 'lvl', format('You landed the final blow and took %s.', (select name from villain.cat_items where id = h.loot)));
    if top_id is not null and top_id <> pid then
      perform villain._log(top_id, 'lvl', format('You dealt the most damage to %s and took %s.', h.name, (select name from villain.cat_items where id = h.loot)));
    end if;
    perform villain._wire(format('%s landed the final blow on %s. %s villains share the bounty.', p.name, h.name,
                                 (select count(*) from villain.hero_damage hd where hd.hero_id = h.id)));
    delete from villain.hero_damage where hero_id = h.id;
    hs.defeats := hs.defeats + 1;
    hs.max_hp := round(h.base_hp * power(1.25, hs.defeats));
    hs.hp := hs.max_hp;
    msg := msg || format(' %s has fallen! You landed the final blow.', h.name);
    kind := 'lvl';
  end if;
  update villain.heroes set hp = hs.hp, max_hp = hs.max_hp, defeats = hs.defeats where id = hs.id;
  return jsonb_build_object('msg', msg, 'kind', kind, 'state', villain._state(pid));
end $$;

-- ---------- Shop, crew, lair, vault, skills ----------
create or replace function public.vs_buy(p_token text, p_item text, p_qty int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; it villain.cat_items; total bigint; msg text;
begin
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Buy between 1 and 10 at a time.'; end if;
  p := villain._tick(pid);
  select * into it from villain.cat_items where id = p_item;
  if not found or it.price = 0 then raise exception 'That item is not for sale.'; end if;
  if p.level < it.lvl then raise exception '% unlocks at level %.', it.name, it.lvl; end if;
  total := it.price * p_qty;
  if p.cash < total then raise exception 'You need % on hand.', villain._usd(total); end if;
  p.cash := p.cash - total;
  perform villain._add_item(pid, it.id, p_qty);
  perform villain._save(p);
  msg := format('Bought %s× %s for %s.', p_qty, it.name, villain._usd(total));
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_sell(p_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; it villain.cat_items; back bigint; msg text;
begin
  p := villain._tick(pid);
  select * into it from villain.cat_items where id = p_item;
  if not found or it.price = 0 then raise exception 'Loot can''t be sold.'; end if;
  if villain._owned(pid, it.id) < 1 then raise exception 'You don''t own a %.', it.name; end if;
  update villain.items set qty = qty - 1 where player_id = pid and item = it.id;
  back := it.price / 2;
  p.cash := p.cash + back;
  perform villain._save(p);
  msg := format('Sold a %s for %s.', it.name, villain._usd(back));
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_hire(p_token text, p_qty int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; total bigint := 0; i int; msg text;
begin
  if p_qty is null or p_qty < 1 or p_qty > 10 then raise exception 'Hire between 1 and 10 at a time.'; end if;
  p := villain._tick(pid);
  for i in 0 .. p_qty - 1 loop
    total := total + floor(150 * power(1.11, p.hench + i));
  end loop;
  if p.cash < total then raise exception 'You need % on hand.', villain._usd(total); end if;
  p.cash := p.cash - total;
  p.hench := p.hench + p_qty;
  perform villain._save(p);
  msg := format('Hired %s henchm%s for %s. Crew is now %s.', p_qty, case when p_qty = 1 then 'an' else 'en' end, villain._usd(total), p.hench + 1);
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_buy_prop(p_token text, p_prop text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; pr villain.cat_props; owned int; c bigint; msg text;
begin
  p := villain._tick(pid);
  select * into pr from villain.cat_props where id = p_prop;
  if not found then raise exception 'Unknown property.'; end if;
  if p.level < pr.lvl then raise exception '% unlocks at level %.', pr.name, pr.lvl; end if;
  owned := coalesce((select qty from villain.props where player_id = pid and prop = pr.id), 0);
  c := floor(pr.price * power(1.1, owned));
  if p.cash < c then raise exception 'You need % on hand.', villain._usd(c); end if;
  p.cash := p.cash - c;
  insert into villain.props (player_id, prop, qty) values (pid, pr.id, 1)
  on conflict (player_id, prop) do update set qty = villain.props.qty + 1;
  perform villain._save(p);
  msg := format('Bought a %s for %s.', pr.name, villain._usd(c));
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_deposit(p_token text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; fee bigint; msg text;
begin
  p := villain._tick(pid);
  if p_amount is null or p_amount < 1 or p_amount > p.cash then raise exception 'Enter an amount up to your cash on hand.'; end if;
  fee := ceil(p_amount * case when p.arch = 'shadow' then 0.05 else 0.10 end);
  p.cash := p.cash - p_amount;
  p.bank := p.bank + p_amount - fee;
  perform villain._save(p);
  msg := format('Deposited %s in the vault (fee %s).', villain._usd(p_amount - fee), villain._usd(fee));
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_withdraw(p_token text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; msg text;
begin
  p := villain._tick(pid);
  if p_amount is null or p_amount < 1 or p_amount > p.bank then raise exception 'Enter an amount up to your vault balance.'; end if;
  p.bank := p.bank - p_amount;
  p.cash := p.cash + p_amount;
  perform villain._save(p);
  msg := format('Withdrew %s from the vault.', villain._usd(p_amount));
  perform villain._log(pid, '', msg);
  return jsonb_build_object('msg', msg, 'kind', '', 'state', villain._state(pid));
end $$;

create or replace function public.vs_skill(p_token text, p_skill text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare pid bigint := villain._auth(p_token); p villain.players; cost int;
begin
  p := villain._tick(pid);
  cost := case p_skill when 'max_st' then 2 when 'atk' then 1 when 'def' then 1 when 'max_en' then 1 when 'max_hp' then 1 end;
  if cost is null then raise exception 'Unknown skill.'; end if;
  if p.sp < cost then raise exception 'Not enough skill points.'; end if;
  p.sp := p.sp - cost;
  case p_skill
    when 'atk' then p.atk := p.atk + 1;
    when 'def' then p.def := p.def + 1;
    when 'max_en' then p.max_en := p.max_en + 1; p.en := p.en + 1;
    when 'max_st' then p.max_st := p.max_st + 1; p.st := p.st + 1;
    when 'max_hp' then p.max_hp := p.max_hp + 10; p.hp := p.hp + 10;
  end case;
  perform villain._save(p);
  return jsonb_build_object('msg', null, 'kind', '', 'state', villain._state(pid));
end $$;

-- ---------- World: shared view of the underworld ----------
create or replace function public.vs_world() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'now', floor(extract(epoch from now()) * 1000),
    'players', (select count(*) from villain.players),
    'online', (select count(*) from villain.players where last_seen > now() - interval '5 minutes'),
    'wire', coalesce((select jsonb_agg(jsonb_build_object('t', floor(extract(epoch from e.created_at) * 1000), 'text', e.body) order by e.id desc)
                        from (select * from villain.events ev where ev.player_id is null order by ev.id desc limit 30) e), '[]'::jsonb),
    'hitlist', coalesce((select jsonb_agg(h order by h.amount desc) from (
                          select p.id, p.name, p.level, sum(b.amount) as amount
                            from villain.bounties b join villain.players p on p.id = b.target_id
                           where b.claimed_at is null
                           group by p.id, p.name, p.level
                           order by sum(b.amount) desc limit 10) h), '[]'::jsonb),
    'leaders', coalesce((select jsonb_agg(l) from (
                          select p.id, p.name, p.arch, p.level, p.pvp_wins, p.heroes,
                                 p.last_seen > now() - interval '5 minutes' as online
                            from villain.players p order by p.level desc, p.xp desc, p.id limit 20) l), '[]'::jsonb),
    'heroes', coalesce((select jsonb_agg(jsonb_build_object(
                          'id', hs.id, 'hp', hs.hp, 'max_hp', hs.max_hp, 'defeats', hs.defeats,
                          'top', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'dmg', hd.dmg) order by hd.dmg desc)
                                             from (select * from villain.hero_damage x where x.hero_id = hs.id order by x.dmg desc limit 3) hd
                                             join villain.players p on p.id = hd.player_id), '[]'::jsonb),
                          'fighters', (select count(*) from villain.hero_damage x where x.hero_id = hs.id)))
                        from villain.heroes hs), '[]'::jsonb)
  )
$$;

-- ---------- Permissions: only the vs_* API is callable ----------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'vs\_%' loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'villain' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
