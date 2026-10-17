VILLAIN SYNDICATE
=================

A multiplayer text RPG in the style of the old energy/stamina "villain empire" games.
Every villain in the game is another player.

GAMEPLAY
--------
- Schemes: spend energy for cash and XP across five districts; master a district to take it
  over and win a loot item.
- Fights: spend stamina to rob other players (from level 3) or street goons.
- Bounties: put a price on a rival's head; whoever drops them below 20 health collects it.
- Heroes: shared world bosses; the bounty is split by damage dealt.
- Arsenal, Crew, Lair: buy gear, hire henchmen, buy properties that pay every minute.
- Vault: cash on hand can be stolen, banked cash cannot.
- Underworld: leaderboard, most-wanted list and a live feed of what everyone is doing.

HOW IT IS BUILT
---------------
  index.html, styles.css, app.js, art.js   Static site, no build step (deploys as-is to Vercel)
  img/                                     District backdrops, item and property art (WebP)
  supabase/migrations/                     The whole game server, written in Postgres

Game data lives in a private "villain" schema that the Supabase Data API does not expose.
The client can only call public vs_* functions, which check the player's session token and
enforce every rule on the server. Accounts are the game's own (username + bcrypt password),
separate from Supabase Auth. Player portraits are drawn in the browser from each name.

RUNNING LOCALLY
---------------
Serve the folder with any static server (for example `python3 -m http.server`) and open it.
It talks to the live Supabase project configured at the top of app.js. To use your own
backend, apply the migrations in order and change SUPABASE_URL and SUPABASE_KEY.
