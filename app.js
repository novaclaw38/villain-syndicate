(() => {
'use strict';

// ===================== Config =====================
// The publishable key is safe to ship: it only grants what the vs_* functions allow.
const SUPABASE_URL = 'https://eoebdquofjszlvsvkdfa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HdkqvkhrY0C4Jy2QkKdpcQ_HKuh6geQ';
const TOKEN_KEY = 'villain-syndicate-token';
const EN_MS = 12000, ST_MS = 30000, HP_MS = 10000, INC_MS = 60000;

// ===================== Helpers =====================
const $ = s => document.querySelector(s);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = n => Math.floor(n).toLocaleString('en-US');
const usd = n => '$' + num(n);
const short = n => n >= 1e6 ? '$' + (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? '$' + Math.round(n / 1e3) + 'K' : usd(n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ago = t => { const s = Math.max(0, (now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : Math.floor(s / 86400) + 'd ago'; };

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

async function rpc(fn, args = {}) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch (e) {
    throw Object.assign(new Error('Can’t reach the server. Check your connection and try again.'), { code: 'net' });
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) throw Object.assign(new Error((data && data.message) || 'Something went wrong. Try again.'), { code: data && data.code });
  return data;
}

// ===================== State =====================
let CAT = null;          // catalog from the server
let S = null;            // this player's state (server is the source of truth)
let skew = 0;            // server clock minus local clock
let token = store.get(TOKEN_KEY);
let world = null;        // shared world: wire, leaders, hitlist, heroes
let targets = null;      // real players you can attack
let goons = [];
let busy = false;
let ui = { tab: 'schemes', district: 'docks', armory: 'weapon', auth: token ? 'signin' : 'create', archPick: 'mastermind', bountyFor: null, retire: false };

const now = () => Date.now() + skew;

function setState(st) {
  const prevLevel = S ? S.level : null;
  S = st;
  skew = st.t.now - Date.now();
  if (prevLevel != null && S.level > prevLevel) {
    Art.banner(`Level ${S.level}`, 'Meters refilled. Spend your skill points in Profile.', 'lvl');
  }
}

// Show what an action changed: floating numbers at the button, a shake on losses.
let lastBtn = null;
function playEffects(before, res, btn) {
  if (!S || !before) return;
  const rect = btn && document.body.contains(btn) ? btn.getBoundingClientRect() : null;
  const x = rect ? rect.left + rect.width / 2 : innerWidth / 2;
  const y = rect ? rect.top : innerHeight / 2;
  const floats = [];
  const dCash = S.cash - before.cash, dBank = S.bank - before.bank, dHp = S.hp - before.hp;
  const dXp = S.level === before.level ? S.xp - before.xp : 0;
  if (dCash && !(dBank && Math.abs(dCash) >= Math.abs(dBank))) floats.push([(dCash > 0 ? '+' : '−') + usd(Math.abs(dCash)), dCash > 0 ? 'f-cash' : 'f-loss']);
  if (dBank > 0) floats.push(['+' + usd(dBank) + ' banked', 'f-cash']);
  if (dXp > 0) floats.push(['+' + dXp + ' XP', 'f-xp']);
  if (dHp < 0) floats.push(['−' + Math.abs(dHp) + ' HP', 'f-loss']);
  const dealt = res && res.msg && /^You hit .+? for ([\d,]+)\./.exec(res.msg);
  if (dealt) floats.unshift(['−' + dealt[1], 'f-hit']);
  floats.forEach(([t, c], i) => Art.floatText(x, y, t, c, i * 140));
  if (res && res.kind === 'loss') { Art.shake($('#main')); Art.shake($('#hud')); }
  if (dealt) Art.shake(btn && btn.closest('.boss') && btn.closest('.boss').querySelector('.hero-portrait'));
  const fell = res && res.msg && /has fallen!/.test(res.msg);
  if (fell) Art.banner(res.msg.match(/ ([^.!]+) has fallen!/)?.[1] + ' has fallen!', 'The bounty is split among everyone who fought.', 'hero');
  else if (res && res.kind === 'win' && rect && !(S.level > before.level)) Art.burst(x, y, ['#5ee0a0', '#ff8a1f', '#ffd23f'], 18);
}

function indexCatalog(c) {
  const by = list => Object.fromEntries(list.map(x => [x.id, x]));
  return {
    archs: by(c.archs), archList: c.archs,
    items: by(c.items), itemList: c.items,
    districts: c.districts,
    schemes: c.schemes,
    props: c.props,
    heroes: c.heroes,
  };
}

// Regenerated meters, computed locally between server refreshes (same formulas as the server).
function cur(key) {
  const max = S['max_' + key];
  const val = S[key];
  if (val >= max) return max;
  const ms = key === 'en' ? EN_MS : key === 'st' ? ST_MS : HP_MS;
  const step = key === 'hp' ? Math.max(1, Math.round(S.max_hp / 60)) : 1;
  const n = Math.floor((now() - S.t[key]) / ms);
  return Math.min(max, val + Math.max(0, n) * step);
}
function nextIn(key) {
  const ms = key === 'en' ? EN_MS : key === 'st' ? ST_MS : HP_MS;
  return ms - ((now() - S.t[key]) % ms);
}

const owned = id => (S.items && S.items[id]) || 0;
const henchCost = n => Math.floor(150 * Math.pow(1.11, n));
const propCost = p => Math.floor(p.price * Math.pow(1.1, (S.props && S.props[p.id]) || 0));
const incomePerMin = () => CAT.props.reduce((sum, p) => sum + p.income * ((S.props && S.props[p.id]) || 0), 0);
const vaultFee = () => S.arch === 'shadow' ? 0.05 : 0.10;
const healCost = () => Math.ceil((S.max_hp - cur('hp')) * (2 + S.level * 1.5));

function missing(req) {
  return Object.entries(req).map(([k, n]) => k === 'h'
    ? { label: `${n} henchmen`, ok: S.hench >= n }
    : { label: `${n}× ${CAT.items[k].name}`, ok: owned(k) >= n });
}

// ===================== Toasts =====================
function toast(html, kind = '') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = html;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), 4500);
}

// ===================== Server calls =====================
async function call(fn, args = {}, after) {
  if (busy) return;
  busy = true;
  document.body.classList.add('busy');
  const btn = lastBtn;
  const before = S && { cash: S.cash, bank: S.bank, xp: S.xp, level: S.level, hp: cur('hp') };
  try {
    const res = await rpc(fn, { p_token: token, ...args });
    if (res && res.state) setState(res.state);
    if (res && res.msg) toast(esc(res.msg), res.kind || '');
    playEffects(before, res, btn);
    if (after) await after(res);
  } catch (e) {
    if (e.code === '28000') return signOut(e.message);
    toast(esc(e.message), 'loss');
  } finally {
    busy = false;
    document.body.classList.remove('busy');
    if (S) renderAll();
  }
}

async function refreshState() {
  if (!token) return;
  try { setState(await rpc('vs_state', { p_token: token })); renderAll(); }
  catch (e) { if (e.code === '28000') signOut(e.message); }
}
async function refreshWorld() {
  try { world = await rpc('vs_world'); if (S) renderMain(); } catch (e) {}
}
async function refreshTargets() {
  if (!token) return;
  try { targets = await rpc('vs_targets', { p_token: token }); if (S && ui.tab === 'fights') renderMain(); }
  catch (e) { if (e.code === '28000') signOut(e.message); }
}

function signOut(msg) {
  if (token) rpc('vs_logout', { p_token: token }).catch(() => {});
  token = null; S = null; targets = null;
  store.del(TOKEN_KEY);
  ui.auth = 'signin';
  renderAuth(msg || '');
}

// ===================== Goons =====================
const GOON_PRE = ['Doctor', 'Baron', 'Madame', 'Professor', 'Count', 'Lord', 'Captain', 'Mister', 'Lady', 'Duchess', 'Major', ''];
const GOON_NAME = ['Malvolo', 'Gristle', 'Nightshade', 'Vex', 'Cinder', 'Hexley', 'Morrow', 'Quill', 'Rook', 'Sable', 'Voltaire', 'Kraken', 'Mortis', 'Blight', 'Ember', 'Static', 'Wormwood', 'Gloom', 'Saltpeter', 'Mandible'];
const GOON_TAG = ['runs the sewer syndicate', 'controls the toxic waste trade', 'builds doomsday clocks', 'breeds mutant eels', 'counterfeits moon rocks', 'sells cursed antiques', 'hacks traffic lights', 'trains attack pigeons', 'owns a haunted blimp', 'collects stolen statues'];
function scoutGoons() {
  const diffs = ['easy', 'easy', 'even', 'even', 'risky'];
  goons = diffs.map((diff, i) => {
    const pre = pick(GOON_PRE);
    return { id: 'g' + i + Math.random().toString(36).slice(2, 6), diff, name: (pre ? pre + ' ' : '') + pick(GOON_NAME), tag: pick(GOON_TAG) };
  });
}

// ===================== Actions =====================
const act = {
  tab(t) {
    ui.tab = t; ui.bountyFor = null; ui.retire = false;
    renderAll();
    enterAnimation();
    if (t === 'fights') refreshTargets();
    if (t === 'heroes' || t === 'underworld') refreshWorld();
  },
  district(id) { ui.district = id; renderMain(); enterAnimation(); },
  armory(t) { ui.armory = t; renderMain(); },
  authMode(m) { ui.auth = m; renderAuth(''); },
  arch(k) { ui.archPick = k; document.querySelectorAll('.arch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.arg === k))); updatePreview(); },

  scheme(id) { call('vs_scheme', { p_scheme: id }); },
  goon(id) {
    const g = goons.find(x => x.id === id); if (!g) return;
    call('vs_fight_goon', { p_diff: g.diff, p_name: g.name });
  },
  scoutGoons() { scoutGoons(); renderMain(); },
  scoutRivals() { refreshTargets(); },
  attack(id) { call('vs_attack', { p_target: +id }, refreshTargets); },
  bountyForm(id) { ui.bountyFor = ui.bountyFor === +id ? null : +id; renderMain(); const el = $('#bounty-amt'); if (el) el.focus(); },
  heal() { call('vs_heal'); },
  strike(arg) { const [id, n] = arg.split(':'); call('vs_strike', { p_hero: id, p_times: +n }, refreshWorld); },
  buy(arg) { const [id, n] = arg.split(':'); call('vs_buy', { p_item: id, p_qty: +n }); },
  sell(id) { call('vs_sell', { p_item: id }); },
  hire(n) { call('vs_hire', { p_qty: +n }); },
  prop(id) { call('vs_buy_prop', { p_prop: id }); },
  deposit(arg) { const amt = arg === 'all' ? S.cash : Math.floor(+($('#vault-amt')?.value || 0)); call('vs_deposit', { p_amount: amt }); },
  withdraw(arg) { const amt = arg === 'all' ? S.bank : Math.floor(+($('#vault-amt')?.value || 0)); call('vs_withdraw', { p_amount: amt }); },
  skill(k) { call('vs_skill', { p_skill: k }); },
  signOut() { signOut(''); },
  retire() { ui.retire = !ui.retire; renderMain(); },
};

const forms = {
  async auth(form) {
    const f = new FormData(form);
    const err = $('#auth-error');
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      let res;
      if (ui.auth === 'create') {
        res = await rpc('vs_register', { p_username: f.get('username'), p_password: f.get('password'), p_name: f.get('vname'), p_arch: ui.archPick });
      } else {
        res = await rpc('vs_login', { p_username: f.get('username'), p_password: f.get('password') });
        if (res.error) throw new Error(res.error);
      }
      token = res.token;
      store.set(TOKEN_KEY, token);
      setState(res.state);
      enterGame();
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  },
  bounty(form) {
    const amt = Math.floor(+new FormData(form).get('amount') || 0);
    const target = ui.bountyFor;
    call('vs_bounty', { p_target: target, p_amount: amt }, async () => { ui.bountyFor = null; await refreshTargets(); refreshWorld(); });
  },
  retire(form) {
    const pw = new FormData(form).get('password');
    call('vs_delete_account', { p_password: pw }, () => {
      token = null; S = null; store.del(TOKEN_KEY); ui.retire = false; ui.auth = 'create';
      renderAuth('Your villain has retired. Start a new one any time.');
    });
  },
};

// ===================== Render: auth =====================
function renderAuth(message) {
  const create = ui.auth === 'create';
  $('#app').innerHTML = `
  <main class="intro">
    <div class="scene-banner hero-scene">${Art.sceneTag('keyart')}<h1>Villain<span>Syndicate</span></h1></div>
    <p class="lede">The city is soft and its heroes are tired. Run schemes, rob rival villains, team up to take down heroes and build a lair that pays while you sleep. Every villain here is another player.</p>
    <div class="auth-tabs">
      <button class="chip" data-act="authMode" data-arg="create" aria-pressed="${create}">New villain</button>
      <button class="chip" data-act="authMode" data-arg="signin" aria-pressed="${!create}">Sign in</button>
    </div>
    <form class="auth-form" data-form="auth" autocomplete="on">
      <div class="field">
        <label class="label" for="username">Username</label>
        <input class="text-in" id="username" name="username" required minlength="3" maxlength="20" pattern="[A-Za-z0-9_]+" autocomplete="username" placeholder="doctor_nobody">
      </div>
      <div class="field">
        <label class="label" for="password">Password</label>
        <input class="text-in" id="password" name="password" type="password" required minlength="6" autocomplete="${create ? 'new-password' : 'current-password'}">
      </div>
      ${create ? `
      <div class="preview-row">
        <div id="preview">${Art.portraitTag('Doctor Nobody', { size: 112, arch: ui.archPick, cls: 'preview-portrait' })}</div>
        <div class="field" style="flex:1;min-width:0">
          <label class="label" for="vname">Villain name, shown to other players</label>
          <input class="text-in" id="vname" name="vname" required minlength="2" maxlength="24" placeholder="Doctor Nobody" autocomplete="off">
          <small class="vsub">Your face is drawn from your name and style. Try a few.</small>
        </div>
      </div>
      <div class="field">
        <span class="label">Choose your style</span>
        <div class="archs">
          ${CAT.archList.map(a => `
            <button type="button" class="arch" data-act="arch" data-arg="${a.id}" aria-pressed="${a.id === ui.archPick}">
              <img class="arch-img" src="img/arch-${a.id}.webp" alt="" loading="lazy">
              <span class="arch-text"><b>${esc(a.name)}</b><small>${esc(a.blurb)}</small>
              <small class="num">EN ${a.en} · ST ${a.st} · HP ${a.hp} · ATK ${a.atk} · DEF ${a.def}</small></span>
            </button>`).join('')}
        </div>
      </div>` : ''}
      <p class="form-error" id="auth-error">${esc(message)}</p>
      <button class="btn big" type="submit">${create ? 'Begin your reign' : 'Sign in'}</button>
    </form>
  </main>`;
  Art.paintPortraits($('#app'));
  Art.runScenes();
}
function updatePreview() {
  const box = $('#preview'); if (!box) return;
  const name = ($('#vname')?.value || '').trim() || 'Doctor Nobody';
  box.innerHTML = Art.portraitTag(name, { size: 112, arch: ui.archPick, cls: 'preview-portrait pop' });
  Art.paintPortraits(box);
}

// ===================== Render: game =====================
function meter(label, key) {
  const v = cur(key), max = S['max_' + key];
  const ms = key === 'en' ? EN_MS : key === 'st' ? ST_MS : HP_MS;
  return `<div class="meter">
    <div class="top"><span>${label}</span><span class="val">${num(v)}/${num(max)}</span></div>
    <div class="bar"><i style="width:${clamp(v / max * 100, 0, 100)}%;background:var(--${key === 'en' ? 'en' : key === 'st' ? 'st' : 'hp'})"></i></div>
    <div class="tm">${v >= max ? 'Full' : '+' + (key === 'hp' ? Math.max(1, Math.round(S.max_hp / 60)) : 1) + ' in ' + mmss(nextIn(key))}${key === 'hp' && v < max ? healButton('heal-mini') : ''}</div></div>`;
}
// Regen tank button, shown in the HUD and on the fight tabs. Heals to full instantly for cash.
function healButton(cls = 'btn ghost') {
  const hp = cur('hp');
  if (hp >= S.max_hp) return '';
  const c = healCost();
  return `<button class="${cls}" data-act="heal" ${S.cash < c ? `disabled title="You need ${usd(c)} on hand"` : `title="Regen tank: full health now"`}>Heal · ${usd(c)}</button>`;
}
function bountyAlert() {
  if (!(S.bounty > 0)) return '';
  const hp = cur('hp');
  return `<div class="bounty-alert" role="status">
    <img src="img/wanted.webp" alt="" class="wanted-img" onerror="this.remove()">
    <p><b>${usd(S.bounty)} bounty on your head.</b> Anyone who knocks you below 20 health collects it.<span class="more"> Higher health means attackers need more hits, and each one can hit you only 5 times an hour. Bank your cash so they can't take that too.</span></p>
    <div class="alert-acts">${hp < S.max_hp ? healButton('btn') : '<span class="vsub">Health full</span>'}${S.cash > 0 ? '<button class="btn ghost" data-act="tab" data-arg="vault">Bank cash</button>' : ''}</div>
  </div>`;
}

// Cash in the HUD counts toward its new value instead of jumping.
let shownCash = null;
function animateCash() {
  if (shownCash === null || shownCash === S.cash) { shownCash = S.cash; return; }
  const from = shownCash, to = S.cash;
  shownCash = to;
  const el = $('#hud .cash');
  if (el) el.classList.add(to > from ? 'up' : 'down');
  Art.tween(from, to, 700, (v, done) => {
    const c = $('#hud .cash'); if (!c) return;
    c.textContent = usd(Math.round(v));
    if (done) c.classList.remove('up', 'down');
  });
}

function renderHud() {
  const hud = $('#hud'); if (!hud) return;
  const tweening = shownCash !== null && shownCash !== S.cash;
  hud.innerHTML = `<div class="hud-in">
    <div class="who">
      ${Art.portraitTag(S.name, { size: 48, arch: S.arch, cls: 'crest-portrait' })}
      <div style="min-width:0">
        <div class="vname">${esc(S.name)}</div>
        <div class="vsub">Lv <span class="num">${S.level}</span> ${esc(CAT.archs[S.arch].name)} · crew of <span class="num">${S.crew}</span>${S.bounty > 0 ? ` · <span class="bounty-chip">${short(S.bounty)} bounty</span>` : ''}</div>
        <div class="xpbar" title="${num(S.xp)} / ${num(S.xp_need)} XP"><i style="width:${S.xp / S.xp_need * 100}%"></i></div>
      </div>
    </div>
    <div class="meters">${meter('Energy', 'en')}${meter('Stamina', 'st')}${meter('Health', 'hp')}</div>
    <div class="money">
      <div class="cash" title="Cash on hand">${usd(tweening ? shownCash : S.cash)}</div>
      <div class="bank">Vault ${usd(S.bank)}</div>
    </div>
  </div>${bountyAlert()}`;
  Art.paintPortraits(hud);
  if (tweening) animateCash(); else shownCash = S.cash;
}

const TABS = [
  ['schemes', 'Schemes'], ['fights', 'Fights'], ['heroes', 'Heroes'], ['arsenal', 'Arsenal'],
  ['crew', 'Crew'], ['lair', 'Lair'], ['vault', 'Vault'], ['underworld', 'Underworld'], ['profile', 'Profile'],
];
function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([k, n]) =>
    `<button class="tab" role="tab" data-act="tab" data-arg="${k}" aria-selected="${ui.tab === k}">${n}${k === 'profile' && S.sp > 0 ? '<span class="dot" title="Skill points to spend"></span>' : ''}</button>`).join('');
}

function reqChips(req) {
  const m = missing(req);
  if (!m.length) return '';
  return `<div class="reqs">${m.map(r => `<span class="req ${r.ok ? '' : 'miss'}">${r.ok ? '✓' : '✗'} ${esc(r.label)}</span>`).join('')}</div>`;
}

function viewSchemes() {
  const d = CAT.districts.find(x => x.id === ui.district);
  const schemes = CAT.schemes.filter(s => s.district === d.id).sort((a, b) => a.ord - b.ord);
  const done = schemes.filter(s => (S.mastery[s.id] || 0) >= 100).length;
  const owns = S.districts.includes(d.id);
  const en = cur('en');
  const mult = S.arch === 'mastermind' ? 1.1 : 1;
  return `
  <div class="scene-banner">${Art.sceneTag(d.id)}<div class="scene-title"><span class="label">District · Lv ${d.lvl}+</span><h2 class="h2">${esc(d.name)}</h2></div></div>
  <div class="row-head"><div>
    <p class="intro-line">Schemes cost energy and pay cash and XP. Run each one 10 times to master it. Master all four to take the district and claim its ${esc(CAT.items[d.reward].name)}.</p></div>
    <div class="reward"><img class="thumb loot" src="img/items/${d.reward}.webp" alt="" loading="lazy"><span><span class="label">District reward</span><b>${esc(CAT.items[d.reward].name)}</b></span></div></div>
  <div class="chips">${CAT.districts.map(x => `<button class="chip" data-act="district" data-arg="${x.id}" aria-pressed="${x.id === d.id}" ${S.level < x.lvl ? 'disabled' : ''}>${esc(x.name)}${S.level < x.lvl ? ` · Lv ${x.lvl}` : S.districts.includes(x.id) ? ' ✓' : ''}</button>`).join('')}</div>
  <div class="mast ${owns ? 'done' : ''}">District control <div class="bar"><i style="width:${done / schemes.length * 100}%"></i></div> <span class="num">${done}/${schemes.length}</span></div>
  <div class="list">${schemes.map(s => {
    const m = S.mastery[s.id] || 0;
    const blocked = missing(s.req).some(r => !r.ok);
    return `<div class="card">
      <div>
        <div class="title">${esc(s.name)}</div>
        <div class="meta"><span class="e">−${s.energy} energy</span><span>Pays <b class="num">${short(s.cash_min * mult)}–${short(s.cash_max * mult)}</b></span><span class="x">+${s.xp} XP</span></div>
        ${reqChips(s.req)}
        <div class="mast ${m >= 100 ? 'done' : ''}">Mastery <div class="bar"><i style="width:${m}%"></i></div><span class="num">${m}%</span></div>
      </div>
      <div class="acts"><button class="btn" data-act="scheme" data-arg="${s.id}" ${blocked || en < s.energy ? 'disabled' : ''}>${blocked ? 'Need gear' : en < s.energy ? 'No energy' : 'Do it'}</button></div>
    </div>`;
  }).join('')}</div>`;
}

function threat(ratio) {
  return ratio >= 1.15 ? ['easy', 'Easy mark'] : ratio >= 0.85 ? ['even', 'Even match'] : ['risky', 'Risky'];
}

function viewFights() {
  const st = cur('st'), hp = cur('hp');
  const canFight = st >= 1 && hp >= 20;
  const fightLabel = hp < 20 ? 'Too hurt' : st < 1 ? 'No stamina' : 'Fight';
  const rivals = targets === null
    ? '<p class="notice">Finding rival villains…</p>'
    : !targets.length
      ? '<p class="notice">No other villains yet. Share this page with friends so you have someone to rob.</p>'
      : `<div class="list">${targets.map(t => {
          const th = threat(+t.ratio);
          const protectedT = t.level < 3;
          const down = t.hp_now < 20;
          const capped = t.hits >= 5;
          const reason = S.level < 3 ? 'Lv 3 to attack' : protectedT ? 'Newcomer' : down ? 'Recovering' : capped ? 'Hit limit' : fightLabel;
          const disabled = S.level < 3 || protectedT || down || capped || !canFight;
          const minBounty = 500 * t.level;
          return `<div class="card with-pic">
            ${Art.portraitTag(t.name, { size: 52, arch: t.arch })}
            <div>
              <div class="title"><span class="${t.online ? 'online' : 'offline'}" title="${t.online ? 'Online now' : 'Offline'}"></span>${esc(t.name)} <span class="threat ${th[0]}">${th[1]}</span> ${t.bounty > 0 ? `<span class="bounty-chip">${short(t.bounty)} bounty</span>` : ''}</div>
              <div class="meta"><span>Lv <b class="num">${t.level}</b></span><span>${esc(CAT.archs[t.arch].name)}</span><span>Crew <b class="num">${t.crew}</b></span><span>Health <b class="num">${t.hp_now}/${t.max_hp}</b></span><span>Hits this hour <b class="num">${t.hits}/5</b></span></div>
            </div>
            <div class="acts">
              <button class="btn" data-act="attack" data-arg="${t.id}" ${disabled ? 'disabled' : ''}>${reason === fightLabel ? 'Attack' : reason}</button>
              <button class="btn ghost" data-act="bountyForm" data-arg="${t.id}">Bounty</button>
            </div>
            ${ui.bountyFor === t.id ? `
            <form class="inline-form" data-form="bounty">
              <img class="wanted-img" src="img/wanted.webp" alt="" loading="lazy">
              <label class="label" for="bounty-amt">Bounty on ${esc(t.name)}</label>
              <input class="text-in" id="bounty-amt" name="amount" type="number" min="${minBounty}" step="1" value="${minBounty}" required>
              <button class="btn" type="submit">Post bounty</button>
              <span class="vsub">At least ${usd(minBounty)}. Whoever knocks them out collects it.</span>
            </form>` : ''}
          </div>`;
        }).join('')}</div>`;
  return `
  <div class="row-head">
    <div><h2 class="h2">Fights</h2>
    <p class="intro-line">Each fight costs 1 stamina. Beat a rival villain to take 10% of the cash they carry. Knock them below 20 health to collect any bounty on their head. Your crew carries your best weapon, armor and vehicle for every member.</p></div>
  </div>
  <div class="stat-strip">
    <div><span>Attack</span><b>${num(S.power.atk)}</b></div>
    <div><span>Defense</span><b>${num(S.power.def)}</b></div>
    <div><span>Crew</span><b>${S.crew}</b></div>
    <div><span>Rivals beaten</span><b>${S.stats.pvp_wins}–${S.stats.pvp_losses}</b></div>
    <div class="tank"><img src="img/regen-tank.webp" alt="" loading="lazy"><div>${healButton() || '<span class="vsub">Health full</span>'}</div></div>
  </div>
  <div class="row-head"><h3 class="section-title">Rival villains</h3><button class="btn ghost" data-act="scoutRivals">Refresh</button></div>
  ${S.level < 3 ? '<p class="notice">You can attack other players from level 3. Until then, fight street goons below. Players under level 3 can’t be attacked either.</p>' : ''}
  ${rivals}
  <div class="row-head"><h3 class="section-title">Street goons</h3><button class="btn ghost" data-act="scoutGoons">Scout new goons</button></div>
  <div class="list">${goons.map(g => {
    const th = { easy: ['easy', 'Easy mark'], even: ['even', 'Even match'], risky: ['risky', 'Risky'] }[g.diff];
    return `<div class="card with-pic">
      ${Art.portraitTag(g.name, { size: 52 })}
      <div><div class="title">${esc(g.name)} <span class="threat ${th[0]}">${th[1]}</span></div>
      <div class="meta"><span>${esc(g.tag)}</span></div></div>
      <div class="acts"><button class="btn" data-act="goon" data-arg="${g.id}" ${canFight ? '' : 'disabled'}>${fightLabel}</button></div>
    </div>`;
  }).join('')}</div>`;
}

function viewHeroes() {
  const st = cur('st'), hp = cur('hp');
  const live = Object.fromEntries(((world && world.heroes) || []).map(h => [h.id, h]));
  return `
  <div class="row-head">
    <div><h2 class="h2">Heroes on patrol</h2>
    <p class="intro-line">Heroes are shared by every villain in the game. Everyone hits the same health bar, and when a hero falls the bounty is split by how much damage each villain dealt. The final blow and the top damage dealer each take the hero's gear. Each defeat brings them back stronger.</p></div>
    ${healButton()}
  </div>
  <div class="list">${CAT.heroes.map(H => {
    const h = live[H.id] || { hp: H.base_hp, max_hp: H.base_hp, defeats: 0, top: [], fighters: 0 };
    if (S.level < H.lvl) return `<div class="boss locked"><div class="boss-head"><img class="hero-portrait silhouette" src="img/hero-${H.id}.webp" alt="" loading="lazy"><div class="boss-id"><div class="name">${esc(H.name)}</div><p class="quote">Fights villains of level ${H.lvl} and up.</p></div></div></div>`;
    const scale = 1 + h.defeats * 0.25;
    return `<div class="boss">
      <div class="boss-head"><img class="hero-portrait" src="img/hero-${H.id}.webp" alt="${esc(H.name)}" loading="lazy"><div class="boss-id"><div class="name">${esc(H.name)}</div><span class="vsub">Defeated <span class="num">${h.defeats}</span>× · <span class="num">${h.fighters}</span> villain${h.fighters === 1 ? '' : 's'} fighting</span>
      <p class="quote">${esc(H.quote)}</p></div></div>
      <div class="hpbar"><i style="width:${h.hp / h.max_hp * 100}%"></i><span>${num(h.hp)} / ${num(h.max_hp)}</span></div>
      <div class="meta" style="display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--muted);font-size:.92rem">
        <span>Shared bounty <b class="c num">${short(H.cash_min * scale)}+</b></span><span class="x">${num(H.xp * scale)} XP split</span><span>Drops ${esc(CAT.items[H.loot].name)}</span>
      </div>
      ${h.top.length ? `<div class="top-dmg">Top damage: ${h.top.map(t => `<span><b>${esc(t.name)}</b> ${num(t.dmg)}</span>`).join('')}</div>` : ''}
      <div class="acts" style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn" data-act="strike" data-arg="${H.id}:1" ${st >= 1 && hp >= 10 ? '' : 'disabled'}>Strike · 1 ST</button>
        <button class="btn ghost" data-act="strike" data-arg="${H.id}:5" ${st >= 5 && hp >= 10 ? '' : 'disabled'}>Strike ×5 · 5 ST</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function viewArsenal() {
  const names = { weapon: 'Weapons', armor: 'Armor', vehicle: 'Vehicles' };
  const list = CAT.itemList.filter(it => it.type === ui.armory && (it.price || owned(it.id)));
  return `
  <div class="row-head"><div><h2 class="h2">Arsenal</h2>
    <p class="intro-line">Your crew of ${S.crew} takes your ${S.crew} best ${names[ui.armory].toLowerCase()} into every fight. Extras only count toward scheme requirements. Items sell back for half price.</p></div></div>
  <div class="chips">${Object.entries(names).map(([k, n]) => `<button class="chip" data-act="armory" data-arg="${k}" aria-pressed="${ui.armory === k}">${n}</button>`).join('')}</div>
  <div class="list">${list.map(it => {
    const locked = it.price && S.level < it.lvl;
    return `<div class="card with-pic ${locked ? 'locked' : ''}">
      <img class="thumb ${!it.price ? 'loot' : ''}" src="img/items/${it.id}.webp" alt="" loading="lazy">
      <div>
        <div class="title">${esc(it.name)}${!it.price ? ' <span class="threat even">Loot</span>' : ''}</div>
        <div class="meta"><span>ATK <b class="num">${it.atk}</b></span><span>DEF <b class="num">${it.def}</b></span><span>Owned <b class="num">${owned(it.id)}</b></span>${it.price ? `<span>${locked ? 'Unlocks at Lv ' + it.lvl : 'Price <b class="num">' + usd(it.price) + '</b>'}</span>` : ''}</div>
      </div>
      <div class="acts">${it.price ? `
        <button class="btn" data-act="buy" data-arg="${it.id}:1" ${locked || S.cash < it.price ? 'disabled' : ''}>Buy 1</button>
        <button class="btn ghost" data-act="buy" data-arg="${it.id}:5" ${locked || S.cash < it.price * 5 ? 'disabled' : ''}>Buy 5</button>
        <button class="btn ghost" data-act="sell" data-arg="${it.id}" ${owned(it.id) ? '' : 'disabled'}>Sell</button>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function viewCrew() {
  const one = henchCost(S.hench);
  let five = 0; for (let i = 0; i < 5; i++) five += henchCost(S.hench + i);
  return `
  <div class="row-head"><div><h2 class="h2">Henchmen</h2>
  <p class="intro-line">Every henchman carries one more weapon, armor and vehicle into battle, adds to your attack and defense, and unlocks bigger schemes. Each hire costs more than the last.</p></div></div>
  <div class="panel">
    <div class="stat-strip">
      <div><span>Henchmen</span><b>${S.hench}</b></div>
      <div><span>Crew size</span><b>${S.crew}</b></div>
      <div><span>Next hire</span><b>${usd(one)}</b></div>
    </div>
    <div class="vault-row">
      <button class="btn" data-act="hire" data-arg="1" ${S.cash < one ? 'disabled' : ''}>Hire 1 · ${usd(one)}</button>
      <button class="btn ghost" data-act="hire" data-arg="5" ${S.cash < five ? 'disabled' : ''}>Hire 5 · ${usd(five)}</button>
    </div>
  </div>`;
}

function viewLair() {
  const inc = incomePerMin();
  return `
  <div class="row-head"><div><h2 class="h2">Your lair</h2>
  <p class="intro-line">Fronts and facilities pay into your cash on hand every minute, even while you're away (up to 8 hours). Each purchase raises the next price by 10%.</p></div></div>
  <div class="stat-strip">
    <div><span>Income</span><b class="c">${usd(inc)}/min</b></div>
    <div><span>Next payout</span><b>${mmss(INC_MS - ((now() - S.t.inc) % INC_MS))}</b></div>
  </div>
  <div class="list">${CAT.props.map(p => {
    const locked = S.level < p.lvl, cost = propCost(p);
    return `<div class="card with-pic ${locked ? 'locked' : ''}">
      <img class="thumb wide" src="img/props/${p.id}.webp" alt="" loading="lazy">
      <div><div class="title">${esc(p.name)}</div>
      <div class="meta"><span>Owned <b class="num">${(S.props && S.props[p.id]) || 0}</b></span><span>Pays <b class="num">${usd(p.income)}</b>/min each</span><span>${locked ? 'Unlocks at Lv ' + p.lvl : 'Next costs <b class="num">' + usd(cost) + '</b>'}</span></div></div>
      <div class="acts"><button class="btn" data-act="prop" data-arg="${p.id}" ${locked || S.cash < cost ? 'disabled' : ''}>Buy</button></div>
    </div>`;
  }).join('')}</div>`;
}

function viewVault() {
  const fee = Math.round(vaultFee() * 100);
  return `
  <div class="row-head"><div><h2 class="h2">The vault</h2>
  <p class="intro-line">Rival players take 10% of the cash you carry when they beat you, and street goons raid your lair every few minutes. Money in the vault can't be stolen. Deposits cost a ${fee}% fee; withdrawals are free.</p></div></div>
  <div class="panel">
    <div class="stat-strip">
      <div><span>Cash on hand</span><b class="c">${usd(S.cash)}</b></div>
      <div><span>In the vault</span><b>${usd(S.bank)}</b></div>
    </div>
    <div class="field"><label class="label" for="vault-amt">Amount</label>
      <div class="vault-row">
        <input class="text-in" id="vault-amt" type="number" min="1" step="1" inputmode="numeric" placeholder="0">
        <button class="btn" data-act="deposit">Deposit</button>
        <button class="btn ghost" data-act="deposit" data-arg="all" ${S.cash < 1 ? 'disabled' : ''}>Deposit all</button>
        <button class="btn ghost" data-act="withdraw">Withdraw</button>
        <button class="btn ghost" data-act="withdraw" data-arg="all" ${S.bank < 1 ? 'disabled' : ''}>Withdraw all</button>
      </div>
    </div>
  </div>`;
}

function viewUnderworld() {
  if (!world) return '<p class="notice">Listening to the underworld…</p>';
  return `
  <div class="row-head"><div><h2 class="h2">The underworld</h2>
  <p class="intro-line"><span class="num">${num(world.players)}</span> villains in the syndicate, <span class="num">${num(world.online)}</span> online now.</p></div></div>
  <div class="two-col">
    <section>
      <h3 class="section-title most-wanted"><img class="wanted-img" src="img/wanted.webp" alt="" loading="lazy">Most wanted</h3>
      ${world.hitlist.length ? `<div class="table-wrap"><table class="board-table">
        <thead><tr><th>Villain</th><th class="num">Lv</th><th class="num">Bounty</th></tr></thead>
        <tbody>${world.hitlist.map(h => `<tr class="${h.id === S.id ? 'me' : ''}"><td>${esc(h.name)}</td><td class="num">${h.level}</td><td class="num">${usd(h.amount)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="notice">No open bounties. Post one from the Fights tab.</p>'}
      <h3 class="section-title" style="margin-top:16px">The wire</h3>
      ${world.wire.length ? `<ul class="wire">${world.wire.map(w => `<li><time>${ago(w.t)}</time>${esc(w.text)}</li>`).join('')}</ul>` : '<p class="notice">Quiet night in the city.</p>'}
    </section>
    <section>
      <h3 class="section-title">Top villains</h3>
      <div class="table-wrap"><table class="board-table">
        <thead><tr><th class="num">#</th><th>Villain</th><th class="num">Lv</th><th class="num">Rivals beaten</th><th class="num">Heroes</th></tr></thead>
        <tbody>${world.leaders.map((l, i) => `<tr class="${l.id === S.id ? 'me' : ''}"><td class="num">${i + 1}</td><td><span class="lb-name">${Art.portraitTag(l.name, { size: 26, arch: l.arch })}<span class="${l.online ? 'online' : 'offline'}"></span>${esc(l.name)}</span></td><td class="num">${l.level}</td><td class="num">${l.pvp_wins}</td><td class="num">${l.heroes}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
  </div>`;
}

function viewProfile() {
  const skills = [
    ['atk', 'Attack', '+1 base attack (worth 8 power)', S.atk, 1],
    ['def', 'Defense', '+1 base defense (worth 8 power)', S.def, 1],
    ['max_en', 'Max energy', '+1 energy for schemes', S.max_en, 1],
    ['max_st', 'Max stamina', '+1 stamina for fights', S.max_st, 2],
    ['max_hp', 'Max health', '+10 health', S.max_hp, 1],
  ];
  return `
  <div class="row-head"><div class="profile-id">${Art.portraitTag(S.name, { size: 96, arch: S.arch, cls: 'profile-portrait' })}<div><h2 class="h2">${esc(S.name)}</h2>
  <p class="intro-line">Level ${S.level} ${esc(CAT.archs[S.arch].name)}, signed in as <b>${esc(S.username)}</b>. ${esc(CAT.archs[S.arch].blurb)} You get 5 skill points per level and 3 for each district you take.</p></div></div>
  <button class="btn ghost" data-act="signOut">Sign out</button></div>
  <div class="panel">
    <div class="row-head"><span class="label">Skill points</span><b class="num x" style="font-size:1.4rem">${S.sp}</b></div>
    <div>${skills.map(([k, n, d, v, cost]) => `
      <div class="skill"><div><b>${n}</b><small>${d}</small></div><span class="num">${num(v)}</span>
      <button class="btn" data-act="skill" data-arg="${k}" ${S.sp < cost ? 'disabled' : ''}>+ (${cost} SP)</button></div>`).join('')}</div>
  </div>
  <div class="stat-strip">
    <div><span>Total attack</span><b>${num(S.power.atk)}</b></div>
    <div><span>Total defense</span><b>${num(S.power.def)}</b></div>
    <div><span>Schemes run</span><b>${num(S.stats.schemes)}</b></div>
    <div><span>Goons</span><b>${S.stats.wins}–${S.stats.losses}</b></div>
    <div><span>Rivals</span><b>${S.stats.pvp_wins}–${S.stats.pvp_losses}</b></div>
    <div><span>Heroes beaten</span><b>${S.stats.heroes}</b></div>
    <div><span>Lifetime take</span><b>${short(S.stats.earned)}</b></div>
  </div>
  <div class="panel">
    <span class="label">Retire</span>
    ${ui.retire ? `
      <form class="inline-form" data-form="retire">
        <p class="intro-line" style="flex-basis:100%">This permanently deletes ${esc(S.name)} for everyone. Enter your password to confirm.</p>
        <input class="text-in" id="retire-pw" name="password" type="password" required autocomplete="current-password" placeholder="Password">
        <button class="btn danger" type="submit">Delete my villain</button>
        <button class="btn ghost" type="button" data-act="retire">Keep playing</button>
      </form>`
      : `<div><button class="btn ghost" data-act="retire">Retire this villain…</button></div>`}
  </div>`;
}

const VIEWS = { schemes: viewSchemes, fights: viewFights, heroes: viewHeroes, arsenal: viewArsenal, crew: viewCrew, lair: viewLair, vault: viewVault, underworld: viewUnderworld, profile: viewProfile };

function renderMain() {
  const el = $('#main'); if (!el || !S) return;
  // keep typed values and focus when re-rendering around an input
  const a = document.activeElement;
  const keep = a && el.contains(a) && a.tagName === 'INPUT' ? { id: a.id, value: a.value } : null;
  el.innerHTML = VIEWS[ui.tab]();
  if (keep && keep.id) { const inp = document.getElementById(keep.id); if (inp) { inp.value = keep.value; inp.focus(); } }
  Art.paintPortraits(el);
  Art.runScenes();
}
// Cards slide in only when you switch tabs, not on the once-a-second refresh.
function enterAnimation() {
  const el = $('#main'); if (!el) return;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  clearTimeout(enterAnimation.t);
  enterAnimation.t = setTimeout(() => el.classList.remove('enter'), 900);
}
function renderLog() {
  const el = $('#log'); if (!el) return;
  el.innerHTML = S.log.slice(0, 30).map(e => `<li class="${esc(e.kind)}"><time>${clock(e.t)}</time>${esc(e.text)}</li>`).join('');
}
function renderAll() {
  if (!S) return;
  if (!$('#hud')) {
    $('#app').innerHTML = `
      <header class="hud" id="hud"></header>
      <nav class="tabs-wrap"><div class="tabs" role="tablist" id="tabs"></div></nav>
      <div class="board">
        <main class="main" id="main"></main>
        <aside class="dossier" aria-label="Dossier"><h3>Dossier</h3><ol id="log"></ol></aside>
      </div>`;
  }
  renderHud(); renderTabs(); renderMain(); renderLog();
}

// ===================== Loop =====================
let lastMeters = '';
let loops = [];
function enterGame() {
  scoutGoons();
  renderAll();
  window.scrollTo(0, 0);
  enterAnimation();
  refreshWorld();
  refreshTargets();
  loops.forEach(clearInterval);
  loops = [
    // redraw meters every second; redraw the tab when a meter ticks so buttons enable on time
    setInterval(() => {
      if (!S || pointerHeld) return;
      renderHud();
      const sig = [cur('en'), cur('st'), cur('hp')].join(',');
      if (sig !== lastMeters) { lastMeters = sig; if (!busy) renderMain(); }
      else if (ui.tab === 'lair') renderMain();
    }, 1000),
    setInterval(() => { if (S && !busy && document.visibilityState === 'visible') refreshState(); }, 30000),
    setInterval(() => {
      if (!S || document.visibilityState !== 'visible') return;
      if (ui.tab === 'heroes' || ui.tab === 'underworld') refreshWorld();
      if (ui.tab === 'fights') refreshTargets();
    }, 15000),
  ];
}

let pointerHeld = false;
document.addEventListener('pointerdown', () => { pointerHeld = true; });
['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, () => { setTimeout(() => { pointerHeld = false; }, 50); }));
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const fn = act[b.dataset.act];
  if (fn) { e.preventDefault(); lastBtn = b; fn(b.dataset.arg); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  lastBtn = f.querySelector('button[type=submit]');
  forms[f.dataset.form](f);
});
let previewTimer = 0;
document.addEventListener('input', e => {
  if (e.target.id === 'vname') { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 180); }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S) refreshState(); });

// ===================== Boot =====================
(async function boot() {
  try {
    CAT = indexCatalog(await rpc('vs_catalog'));
  } catch (e) {
    $('#app').innerHTML = `<main class="intro"><h1>Villain<span>Syndicate</span></h1><p class="lede">${esc(e.message)}</p><button class="btn big" onclick="location.reload()">Try again</button></main>`;
    return;
  }
  if (token) {
    try { setState(await rpc('vs_state', { p_token: token })); return enterGame(); }
    catch (e) { store.del(TOKEN_KEY); token = null; ui.auth = 'signin'; return renderAuth(e.code === '28000' ? 'Your session expired. Sign in again.' : e.message); }
  }
  renderAuth('');
})();
})();
