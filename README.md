# Villain Syndicate

A multiplayer text RPG in the style of the old energy/stamina "villain empire" games.
Every villain in the game is another player.

- **Schemes**: spend energy for cash and XP across five districts. Master every scheme
  in a district to take it over and win a loot item.
- **Fights**: spend stamina to rob other players (from level 3) or street goons. Beating
  a player takes 10% of the cash they carry.
- **Bounties**: put a price on a rival's head. Whoever knocks them below 20 health collects it.
- **Heroes**: shared world bosses. Every player hits the same health bar, and the bounty
  is split by damage dealt.
- **Arsenal, Crew, Lair**: buy gear, hire henchmen and buy properties that pay every minute.
- **Vault**: cash on hand can be stolen; banked cash can't (deposits cost a fee).
- **Underworld**: leaderboard, most-wanted list and a live wire of what everyone is doing.

## Art

- `img/`: district backdrops, title art, hero and style portraits, art for every item
  (`img/items/`) and lair property (`img/props/`), the regen tank and the wanted poster.
  Generated with FLUX.1-dev and compressed to WebP (about 750 KB in total).
- Player portraits are drawn in the browser by `art.js`, seeded from each villain's name,
  so every player has a unique face that everyone else sees too.
- `art.js` also animates the scenes (rain, searchlights, stars, embers) and plays the game's
  effects: floating cash and XP, screen shake, level-up and hero-kill bursts. All motion is
  turned off when the system asks for reduced motion.

## How it's built

- `index.html`, `styles.css`, `app.js`, `art.js`: a static site with no build step. Deploys as-is to Vercel.
- `supabase/migrations/`: the whole game server, written in Postgres.
  - All game data lives in a private `villain` schema that the Supabase Data API does not expose.
  - The client can only call the `public.vs_*` functions. Each one checks the player's session
    token and enforces every rule on the server (energy, cash, cooldowns), so players can't cheat
    by editing the page.
  - Accounts are the game's own (username + bcrypt-hashed password), separate from Supabase Auth.
    That keeps the game isolated from any other app in the same Supabase project.

The Supabase URL and publishable key are at the top of `app.js`. The publishable key is
meant to be public: it can only call the `vs_*` functions.

## Running locally

Serve the folder with any static server, for example `python3 -m http.server`, and open it.
It talks to the live Supabase project.

To stand up your own backend, apply the three migrations in order to a Supabase project
(`supabase db push`, or paste them into the SQL editor), then change `SUPABASE_URL` and
`SUPABASE_KEY` in `app.js`.
