-- Villain Syndicate: internal engine. None of these are callable by clients.

create or replace function villain._usd(n bigint) returns text
language sql immutable set search_path = '' as $$
  select '$' || to_char(n, 'FM999,999,999,999,990')
$$;

create or replace function villain._xp_need(l int) returns int
language sql immutable set search_path = '' as $$
  select floor(20 + 12 * power(l, 1.45))::int
$$;

create or replace function villain._rint(lo bigint, hi bigint) returns bigint
language sql volatile set search_path = '' as $$
  select lo + floor(random() * (hi - lo + 1))::bigint
$$;

create or replace function villain._auth(p_token text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare pid bigint;
begin
  select s.player_id into pid from villain.sessions s
   where s.token = p_token and s.expires_at > now();
  if pid is null then
    raise exception 'Your session has expired. Sign in again.' using errcode = '28000';
  end if;
  return pid;
end $$;

create or replace function villain._log(pid bigint, p_kind text, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into villain.events (player_id, kind, body) values (pid, p_kind, p_body);
  delete from villain.events e
   where e.player_id = pid
     and e.id < (select e2.id from villain.events e2 where e2.player_id = pid order by e2.id desc offset 79 limit 1);
end $$;

create or replace function villain._wire(p_body text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into villain.events (player_id, kind, body) values (null, 'wire', p_body);
  delete from villain.events e
   where e.player_id is null
     and e.id < (select e2.id from villain.events e2 where e2.player_id is null order by e2.id desc offset 199 limit 1);
end $$;

create or replace function villain._add_item(pid bigint, p_item text, n int) returns void
language sql security definer set search_path = '' as $$
  insert into villain.items (player_id, item, qty) values (pid, p_item, n)
  on conflict (player_id, item) do update set qty = villain.items.qty + excluded.qty;
$$;

create or replace function villain._owned(pid bigint, p_item text) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select i.qty from villain.items i where i.player_id = pid and i.item = p_item), 0)
$$;

-- Combat power: each crew member carries one weapon, one armor and one vehicle.
-- The best `crew` items of each type count, ranked separately for attack and defense.
create or replace function villain._power(pid bigint, base_atk int, base_def int, hench int,
                                          out o_atk int, out o_def int)
language plpgsql stable security definer set search_path = '' as $$
declare
  crew int := 1 + hench;
  ga bigint; gd bigint;
begin
  with units as (
    select ci.type as ty, ci.atk as a, ci.def as d
      from villain.items i
      join villain.cat_items ci on ci.id = i.item
      cross join lateral generate_series(1, least(i.qty, crew)) g
     where i.player_id = pid and i.qty > 0
  ),
  ra as (select u.a, row_number() over (partition by u.ty order by u.a desc) rn from units u),
  rd as (select u.d, row_number() over (partition by u.ty order by u.d desc) rn from units u)
  select coalesce((select sum(ra.a) from ra where ra.rn <= crew), 0),
         coalesce((select sum(rd.d) from rd where rd.rn <= crew), 0)
    into ga, gd;
  o_atk := base_atk * 8 + ga + crew * 2;
  o_def := base_def * 8 + gd + crew * 2;
end $$;

create or replace function villain._save(p villain.players) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update villain.players set
    level = p.level, xp = p.xp, cash = p.cash, bank = p.bank,
    hp = p.hp, max_hp = p.max_hp, en = p.en, max_en = p.max_en, st = p.st, max_st = p.max_st,
    atk = p.atk, def = p.def, sp = p.sp, hench = p.hench,
    t_en = p.t_en, t_st = p.t_st, t_hp = p.t_hp, t_inc = p.t_inc, t_raid = p.t_raid,
    wins = p.wins, losses = p.losses, pvp_wins = p.pvp_wins, pvp_losses = p.pvp_losses,
    schemes = p.schemes, heroes = p.heroes, earned = p.earned, last_seen = p.last_seen
  where id = p.id;
end $$;

create or replace function villain._add_xp(p villain.players, x int) returns villain.players
language plpgsql security definer set search_path = '' as $$
declare need int;
begin
  p.xp := p.xp + x;
  loop
    need := villain._xp_need(p.level);
    exit when p.xp < need;
    p.xp := p.xp - need;
    p.level := p.level + 1;
    p.sp := p.sp + 5;
    p.en := greatest(p.en, p.max_en);
    p.st := greatest(p.st, p.max_st);
    p.hp := greatest(p.hp, p.max_hp);
    perform villain._log(p.id, 'lvl', format('Reached level %s. Energy, stamina and health refilled. +5 skill points.', p.level));
    if p.level % 5 = 0 then
      perform villain._wire(format('%s reached level %s.', p.name, p.level));
    end if;
  end loop;
  return p;
end $$;

-- Lock a player and bring them up to date: regenerate meters, pay lair income, roll for a goon raid.
create or replace function villain._tick(pid bigint) returns villain.players
language plpgsql security definer set search_path = '' as $$
declare
  p villain.players;
  n bigint;
  inc bigint;
  lost bigint;
  hp_amt int;
begin
  select * into p from villain.players where id = pid for update;
  if not found then raise exception 'That villain no longer exists.'; end if;

  -- energy: +1 every 12s
  if p.en >= p.max_en then p.t_en := now();
  else
    n := floor(extract(epoch from now() - p.t_en) / 12);
    if n > 0 then p.en := least(p.max_en, p.en + n); p.t_en := p.t_en + make_interval(secs => n * 12); end if;
    if p.en >= p.max_en then p.t_en := now(); end if;
  end if;
  -- stamina: +1 every 30s
  if p.st >= p.max_st then p.t_st := now();
  else
    n := floor(extract(epoch from now() - p.t_st) / 30);
    if n > 0 then p.st := least(p.max_st, p.st + n); p.t_st := p.t_st + make_interval(secs => n * 30); end if;
    if p.st >= p.max_st then p.t_st := now(); end if;
  end if;
  -- health: +max/60 every 10s
  hp_amt := greatest(1, round(p.max_hp / 60.0));
  if p.hp >= p.max_hp then p.t_hp := now();
  else
    n := floor(extract(epoch from now() - p.t_hp) / 10);
    if n > 0 then p.hp := least(p.max_hp, p.hp + n * hp_amt); p.t_hp := p.t_hp + make_interval(secs => n * 10); end if;
    if p.hp >= p.max_hp then p.t_hp := now(); end if;
  end if;

  -- lair income: every 60s, at most 8 hours while away
  n := floor(extract(epoch from now() - p.t_inc) / 60);
  if n > 0 then
    p.t_inc := p.t_inc + make_interval(secs => n * 60);
    select coalesce(sum(cp.income * pr.qty), 0) into inc
      from villain.props pr join villain.cat_props cp on cp.id = pr.prop
     where pr.player_id = pid;
    if inc > 0 then
      inc := inc * least(n, 480);
      p.cash := p.cash + inc;
      p.earned := p.earned + inc;
      if n > 1 then
        perform villain._log(pid, 'win', format('Your lair earned %s while you were away.', villain._usd(inc)));
      end if;
    end if;
  end if;

  -- street goons try to rob the cash you carry every few minutes
  if now() >= p.t_raid then
    p.t_raid := now() + make_interval(secs => villain._rint(180, 360)::int);
    if p.cash >= 100 and p.level >= 2 and random() >= 0.4 then
      if random() < 0.5 then
        lost := floor(p.cash * 0.15);
        p.cash := p.cash - lost;
        perform villain._log(pid, 'loss', format('Street goons raided your lair and stole %s. Money in the vault is safe.', villain._usd(lost)));
      else
        perform villain._log(pid, 'win', 'Street goons tried to raid your lair. Your defenses held.');
      end if;
    end if;
  end if;

  p.last_seen := now();
  perform villain._save(p);
  return p;
end $$;

-- Full snapshot of one player for the client.
create or replace function villain._state(pid bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p villain.players;
  pw record;
begin
  select * into p from villain.players where id = pid;
  select * into pw from villain._power(p.id, p.atk, p.def, p.hench);
  return jsonb_build_object(
    'id', p.id, 'username', p.username, 'name', p.name, 'arch', p.arch,
    'level', p.level, 'xp', p.xp, 'xp_need', villain._xp_need(p.level),
    'cash', p.cash, 'bank', p.bank,
    'hp', p.hp, 'max_hp', p.max_hp, 'en', p.en, 'max_en', p.max_en, 'st', p.st, 'max_st', p.max_st,
    'atk', p.atk, 'def', p.def, 'sp', p.sp, 'hench', p.hench, 'crew', p.hench + 1,
    'power', jsonb_build_object('atk', pw.o_atk, 'def', pw.o_def),
    't', jsonb_build_object(
      'en', floor(extract(epoch from p.t_en) * 1000), 'st', floor(extract(epoch from p.t_st) * 1000),
      'hp', floor(extract(epoch from p.t_hp) * 1000), 'inc', floor(extract(epoch from p.t_inc) * 1000),
      'now', floor(extract(epoch from now()) * 1000)),
    'stats', jsonb_build_object('wins', p.wins, 'losses', p.losses, 'pvp_wins', p.pvp_wins, 'pvp_losses', p.pvp_losses,
                                'schemes', p.schemes, 'heroes', p.heroes, 'earned', p.earned),
    'items', coalesce((select jsonb_object_agg(i.item, i.qty) from villain.items i where i.player_id = pid and i.qty > 0), '{}'::jsonb),
    'props', coalesce((select jsonb_object_agg(pr.prop, pr.qty) from villain.props pr where pr.player_id = pid and pr.qty > 0), '{}'::jsonb),
    'mastery', coalesce((select jsonb_object_agg(m.scheme, m.pct) from villain.mastery m where m.player_id = pid), '{}'::jsonb),
    'districts', coalesce((select jsonb_agg(d.district) from villain.districts_done d where d.player_id = pid), '[]'::jsonb),
    'bounty', (select coalesce(sum(b.amount), 0) from villain.bounties b where b.target_id = pid and b.claimed_at is null),
    'log', coalesce((select jsonb_agg(jsonb_build_object('t', floor(extract(epoch from e.created_at) * 1000), 'kind', e.kind, 'text', e.body) order by e.id desc)
                       from (select * from villain.events ev where ev.player_id = pid order by ev.id desc limit 40) e), '[]'::jsonb)
  );
end $$;

-- Hand out a reward for a hero kill to one contributor (locks and updates their row).
create or replace function villain._hero_payout(pid bigint, c bigint, x int, p_msg text) returns void
language plpgsql security definer set search_path = '' as $$
declare o villain.players;
begin
  select * into o from villain.players where id = pid for update;
  if not found then return; end if;
  o.cash := o.cash + c;
  o.earned := o.earned + c;
  o.heroes := o.heroes + 1;
  perform villain._log(pid, 'lvl', p_msg);
  o := villain._add_xp(o, x);
  perform villain._save(o);
end $$;

-- Internal functions are never callable from the API roles.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'villain' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
