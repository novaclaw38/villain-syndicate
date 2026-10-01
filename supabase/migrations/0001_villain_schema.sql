-- Villain Syndicate: tables and game catalog.
-- Everything lives in the private `villain` schema, which the Data API does not expose.
-- Clients only reach it through the public.vs_* functions in 0003_villain_api.sql.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists villain;
revoke all on schema villain from public;
revoke all on schema villain from anon, authenticated;

-- ---------- Catalog ----------
create table villain.cat_archs (
  id text primary key, name text not null, blurb text not null,
  en int not null, st int not null, hp int not null, atk int not null, def int not null,
  cash bigint not null, ord int not null
);
create table villain.cat_items (
  id text primary key, name text not null,
  type text not null check (type in ('weapon', 'armor', 'vehicle')),
  atk int not null, def int not null,
  price bigint not null,            -- 0 = loot only
  lvl int not null default 1, ord int not null
);
create table villain.cat_districts (
  id text primary key, name text not null, lvl int not null,
  reward text not null references villain.cat_items(id), ord int not null
);
create table villain.cat_schemes (
  id text primary key, district text not null references villain.cat_districts(id), ord int not null,
  name text not null, energy int not null, cash_min bigint not null, cash_max bigint not null, xp int not null,
  req jsonb not null default '{}'   -- {"h": henchmen, "<item id>": count}
);
create table villain.cat_props (
  id text primary key, name text not null, price bigint not null, income bigint not null, lvl int not null, ord int not null
);
create table villain.cat_heroes (
  id text primary key, name text not null, lvl int not null, base_hp bigint not null, atk int not null,
  cash_min bigint not null, cash_max bigint not null, xp int not null,
  loot text not null references villain.cat_items(id), quote text not null, ord int not null
);

-- ---------- Players ----------
create table villain.players (
  id bigint generated always as identity primary key,
  username text not null unique,
  pass_hash text not null,
  name text not null,
  arch text not null references villain.cat_archs(id),
  level int not null default 1,
  xp int not null default 0,
  cash bigint not null default 0,
  bank bigint not null default 0,
  hp int not null, max_hp int not null,
  en int not null, max_en int not null,
  st int not null, max_st int not null,
  atk int not null, def int not null,
  sp int not null default 0,
  hench int not null default 0,
  t_en timestamptz not null default now(),
  t_st timestamptz not null default now(),
  t_hp timestamptz not null default now(),
  t_inc timestamptz not null default now(),
  t_raid timestamptz not null default now() + interval '4 minutes',
  wins int not null default 0, losses int not null default 0,
  pvp_wins int not null default 0, pvp_losses int not null default 0,
  schemes int not null default 0, heroes int not null default 0,
  earned bigint not null default 0,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create unique index players_name_key on villain.players (lower(name));
create index players_level_idx on villain.players (level);

create table villain.sessions (
  token text primary key,
  player_id bigint not null references villain.players(id) on delete cascade,
  expires_at timestamptz not null
);
create index sessions_player_idx on villain.sessions (player_id);

create table villain.login_fails (
  username text primary key, fails int not null default 0, last_fail timestamptz not null default now()
);

create table villain.items (
  player_id bigint not null references villain.players(id) on delete cascade,
  item text not null references villain.cat_items(id),
  qty int not null check (qty >= 0),
  primary key (player_id, item)
);
create table villain.props (
  player_id bigint not null references villain.players(id) on delete cascade,
  prop text not null references villain.cat_props(id),
  qty int not null check (qty >= 0),
  primary key (player_id, prop)
);
create table villain.mastery (
  player_id bigint not null references villain.players(id) on delete cascade,
  scheme text not null references villain.cat_schemes(id),
  pct int not null,
  primary key (player_id, scheme)
);
create table villain.districts_done (
  player_id bigint not null references villain.players(id) on delete cascade,
  district text not null references villain.cat_districts(id),
  primary key (player_id, district)
);

-- Personal dossier entries (player_id set) and the global underworld wire (player_id null).
create table villain.events (
  id bigint generated always as identity primary key,
  player_id bigint references villain.players(id) on delete cascade,
  kind text not null default '',
  body text not null,
  created_at timestamptz not null default now()
);
create index events_player_idx on villain.events (player_id, id desc);

create table villain.fights (
  id bigint generated always as identity primary key,
  attacker bigint not null references villain.players(id) on delete cascade,
  defender bigint not null references villain.players(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index fights_pair_idx on villain.fights (attacker, defender, created_at);

create table villain.bounties (
  id bigint generated always as identity primary key,
  target_id bigint not null references villain.players(id) on delete cascade,
  placed_by bigint references villain.players(id) on delete set null,
  amount bigint not null check (amount > 0),
  created_at timestamptz not null default now(),
  claimed_by bigint references villain.players(id) on delete set null,
  claimed_at timestamptz
);
create index bounties_open_idx on villain.bounties (target_id) where claimed_at is null;

-- Heroes are shared world bosses: every player chips away at the same health bar.
create table villain.heroes (
  id text primary key references villain.cat_heroes(id),
  hp bigint not null, max_hp bigint not null, defeats int not null default 0
);
create table villain.hero_damage (
  hero_id text not null references villain.heroes(id),
  player_id bigint not null references villain.players(id) on delete cascade,
  dmg bigint not null default 0,
  primary key (hero_id, player_id)
);

-- Defense in depth: RLS on with no policies, so even if the schema were exposed nothing is readable.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'villain' loop
    execute format('alter table villain.%I enable row level security', t);
  end loop;
end $$;

-- ---------- Catalog data ----------
insert into villain.cat_archs values
  ('mastermind', 'Mastermind', 'Starts with more energy. Schemes pay 10% more.', 20, 5, 100, 1, 1, 300, 1),
  ('brute',      'Brute',      'Starts tougher and stronger. Fights pay 15% more.', 15, 7, 120, 3, 1, 200, 2),
  ('shadow',     'Shadow',     'Starts hard to hit. The vault charges you only 5%.', 15, 5, 100, 1, 3, 200, 3);

insert into villain.cat_items (id, name, type, atk, def, price, lvl, ord) values
  ('shiv',     'Rusty Shiv',            'weapon',  2,  0,    150,  1,  1),
  ('zap',      'Zap Glove',             'weapon',  4,  1,    600,  2,  2),
  ('freeze',   'Freeze Ray',            'weapon',  7,  3,   2500,  5,  3),
  ('plasma',   'Plasma Lance',          'weapon', 12,  4,   9000,  9,  4),
  ('gravity',  'Gravity Hammer',        'weapon', 18,  8,  30000, 14,  5),
  ('quantum',  'Quantum Disintegrator', 'weapon', 28, 10, 120000, 22,  6),
  ('doom',     'Doomsday Scepter',      'weapon', 40, 18, 500000, 30,  7),
  ('trench',   'Lined Trenchcoat',      'armor',   0,  2,    120,  1, 10),
  ('kevlar',   'Kevlar Cape',           'armor',   1,  4,    500,  2, 11),
  ('exo',      'Exo-Harness',           'armor',   3,  7,   2200,  5, 12),
  ('nano',     'Nano-Weave Suit',       'armor',   4, 12,   8500,  9, 13),
  ('force',    'Force Field Belt',      'armor',   6, 18,  28000, 14, 14),
  ('void',     'Void Armor',            'armor',  10, 28, 110000, 22, 15),
  ('titan',    'Titan Shell',           'armor',  15, 42, 480000, 30, 16),
  ('van',      'Getaway Van',           'vehicle', 1,  1,    300,  1, 20),
  ('hover',    'Hoverbike',             'vehicle', 3,  2,   1400,  4, 21),
  ('sub',      'Mini-Sub',              'vehicle', 5,  6,   6000,  8, 22),
  ('drill',    'Drill Tank',            'vehicle',10, 10,  22000, 12, 23),
  ('jet',      'Stealth Jet',           'vehicle',16, 12,  85000, 20, 24),
  ('zeppelin', 'War Zeppelin',          'vehicle',24, 22, 350000, 28, 25),
  ('hook',     'Harbor Hook',           'weapon',  6,  2,      0,  1, 30),
  ('katana',   'Neon Katana',           'weapon', 11,  4,      0,  1, 31),
  ('seal',     'Senate Seal Plate',     'armor',   8, 16,      0,  1, 32),
  ('olance',   'Orbital Lance',         'weapon', 26, 10,      0,  1, 33),
  ('throne',   'Lunar Throne',          'vehicle',40, 40,      0,  1, 34),
  ('pshield',  'Paragon''s Shield',     'armor',   4, 10,      0,  1, 35),
  ('lens',     'Lumen Lens',            'weapon', 16,  5,      0,  1, 36),
  ('gauntlet', 'Vigil Gauntlet',        'weapon', 26, 14,      0,  1, 37),
  ('crown',    'Cosmic Crown',          'armor',  30, 40,      0,  1, 38);

insert into villain.cat_districts values
  ('docks',   'Rustwater Docks', 1,  'hook',   1),
  ('neon',    'Neon Row',        5,  'katana', 2),
  ('capitol', 'Capitol Heights', 10, 'seal',   3),
  ('orbit',   'Orbital Ring',    18, 'olance', 4),
  ('moon',    'Moonbase Zero',   28, 'throne', 5);

insert into villain.cat_schemes values
  ('docks-0', 'docks', 0, 'Shake down the dock workers', 1, 40, 80, 1, '{}'),
  ('docks-1', 'docks', 1, 'Smuggle cursed doubloons', 3, 120, 200, 3, '{"van": 1}'),
  ('docks-2', 'docks', 2, 'Hijack a cargo crane', 5, 250, 400, 6, '{"h": 2, "shiv": 2}'),
  ('docks-3', 'docks', 3, 'Flood the harbormaster''s office', 7, 500, 700, 9, '{"h": 3, "trench": 3}'),
  ('neon-0', 'neon', 0, 'Rig the pachinko parlors', 4, 400, 650, 5, '{"zap": 2}'),
  ('neon-1', 'neon', 1, 'Hack every billboard in town', 6, 700, 1000, 8, '{"h": 5, "hover": 1}'),
  ('neon-2', 'neon', 2, 'Kidnap a pop idol''s hologram', 9, 1200, 1700, 13, '{"kevlar": 5}'),
  ('neon-3', 'neon', 3, 'Short out the power grid', 12, 2000, 2800, 18, '{"h": 8, "freeze": 3}'),
  ('capitol-0', 'capitol', 0, 'Blackmail a senator', 10, 3000, 4200, 15, '{"h": 10}'),
  ('capitol-1', 'capitol', 1, 'Swap the mayor with a robot', 14, 5000, 7000, 22, '{"exo": 5, "sub": 2}'),
  ('capitol-2', 'capitol', 2, 'Steal the city''s charter', 18, 8000, 11000, 30, '{"plasma": 5}'),
  ('capitol-3', 'capitol', 3, 'Hold the stock exchange hostage', 24, 14000, 19000, 42, '{"h": 15, "drill": 3}'),
  ('orbit-0', 'orbit', 0, 'Hijack a weather satellite', 20, 20000, 28000, 35, '{"nano": 8}'),
  ('orbit-1', 'orbit', 1, 'Sabotage the space elevator', 26, 32000, 44000, 48, '{"h": 20, "gravity": 5}'),
  ('orbit-2', 'orbit', 2, 'Ransom the orbital casino', 32, 50000, 68000, 62, '{"jet": 5}'),
  ('orbit-3', 'orbit', 3, 'Nudge a comet toward Earth', 40, 80000, 110000, 80, '{"force": 10}'),
  ('moon-0', 'moon', 0, 'Strip-mine the lunar gold', 45, 130000, 170000, 95, '{"h": 30}'),
  ('moon-1', 'moon', 1, 'Build a laser on the dark side', 55, 200000, 260000, 120, '{"quantum": 10}'),
  ('moon-2', 'moon', 2, 'Hold Earth''s tides hostage', 70, 320000, 420000, 160, '{"void": 15, "zeppelin": 5}'),
  ('moon-3', 'moon', 3, 'Crown yourself Emperor of Earth', 90, 600000, 800000, 220, '{"h": 50, "doom": 10}');

insert into villain.cat_props values
  ('bookie',   'Back-Alley Bookie',     1000,    15,    1, 1),
  ('pawn',     'Pawn Shop Front',       5000,    70,    3, 2),
  ('casino',   'Underground Casino',    25000,   320,   7, 3),
  ('barracks', 'Henchman Barracks',     90000,   1100,  12, 4),
  ('volcano',  'Volcano Lair',          400000,  4600,  20, 5),
  ('station',  'Orbital Death Station', 2000000, 22000, 28, 6);

insert into villain.cat_heroes values
  ('paragon',    'Captain Paragon', 3,  3000,  6,  20000,  30000,  400,  'pshield',  '"Truth, justice, and a very firm handshake."', 1),
  ('lumen',      'Lady Lumen',      8,  12000, 14, 90000,  120000, 1200, 'lens',     '"Where I shine, villains scatter."', 2),
  ('vigil',      'The Vigil',       15, 40000, 30, 400000, 520000, 3000, 'gauntlet', '"I never sleep. You will."', 3),
  ('starwarden', 'Starwarden',      25, 120000, 60, 1800000, 2300000, 8000, 'crown',  '"This planet is under my protection."', 4);

insert into villain.heroes (id, hp, max_hp) select id, base_hp, base_hp from villain.cat_heroes;
