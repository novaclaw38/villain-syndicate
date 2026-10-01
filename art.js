// Villain Syndicate art: procedural portraits, animated district scenes, item icons and effects.
// Everything is drawn in the browser, so there are no image files to host.
(() => {
'use strict';

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Seeded randomness: the same name always draws the same face ----------
function seedOf(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; }
  h = Math.imul(h ^ h >>> 16, 2246822507); h = Math.imul(h ^ h >>> 13, 3266489909);
  return (h ^ h >>> 16) >>> 0;
}
function rng(str) {
  let a = seedOf(String(str));
  return () => {
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------- Portraits ----------
const PAL = {
  villain: {
    bg: ['#3a2458', '#5a1e3a', '#1f3b4a', '#4a3a12', '#2a2a3a', '#4a1f1f'],
    skin: ['#f1c7a0', '#d9a173', '#a86b45', '#6e4429', '#9fc7a3', '#9db2d6', '#c9c2d6', '#d6b3b3'],
    suit: ['#1a1024', '#3d1450', '#5a0f1e', '#0f2a2f', '#2d2d2d', '#4b2d0f'],
    acc: ['#ff8a1f', '#c46bff', '#4dd6ff', '#9dff6a', '#ff4d6a', '#ffd23f'],
    hair: ['#111', '#2b1a10', '#6b6b6b', '#e8e8e8', '#7a1f1f', '#3b2a6b'],
  },
  hero: {
    bg: ['#2b6fd6', '#d63b3b', '#e0a81c', '#1aa3a3'],
    skin: ['#f1c7a0', '#d9a173', '#a86b45', '#6e4429', '#ffd9b8'],
    suit: ['#1f5fd1', '#c92c2c', '#f0b81c', '#f4f4f4', '#1aa37a'],
    acc: ['#ffd23f', '#ffffff', '#ff4d4d', '#4dd6ff'],
    hair: ['#111', '#5a3a1a', '#e8c46a', '#b04a1f'],
  },
};
const GEAR = {
  mastermind: { top: ['tophat', 'slick', 'slick', 'bald', 'helmet'], mask: ['monocle', 'monocle', 'none', 'goggles', 'domino'] },
  brute:      { top: ['mohawk', 'horns', 'bald', 'horns', 'helmet'], mask: ['none', 'none', 'goggles', 'visor', 'skull'] },
  shadow:     { top: ['hood', 'hood', 'slick', 'helmet', 'horns'], mask: ['visor', 'domino', 'domino', 'skull', 'none'] },
  any:        { top: ['slick', 'mohawk', 'horns', 'hood', 'tophat', 'helmet', 'bald'], mask: ['none', 'domino', 'visor', 'monocle', 'goggles', 'skull'] },
  hero:       { top: ['slick', 'spiky', 'flat', 'helmet'], mask: ['domino', 'domino', 'none', 'visor'] },
};

function ell(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }

function drawPortrait(ctx, seed, kind, arch) {
  const hero = kind === 'hero';
  const r = rng(kind + ':' + String(seed).toLowerCase());
  const P = a => a[Math.floor(r() * a.length)];
  const pal = hero ? PAL.hero : PAL.villain;
  const gear = hero ? GEAR.hero : (GEAR[arch] || GEAR.any);
  const bg = P(pal.bg), skin = P(pal.skin), suit = P(pal.suit), acc = P(pal.acc), hair = P(pal.hair);
  const top = P(gear.top), mask = P(gear.mask);
  const broad = arch === 'brute' ? 1.18 : arch === 'shadow' ? 0.92 : 1;

  // backdrop: flat color, halftone, and rays for heroes
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 100, 100);
  if (hero) {
    ctx.save(); ctx.translate(50, 50); ctx.fillStyle = 'rgba(255,255,255,.12)';
    for (let i = 0; i < 12; i++) { ctx.rotate(Math.PI / 6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-8, -80); ctx.lineTo(8, -80); ctx.fill(); }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,.2)';
  for (let y = 4; y < 100; y += 6) for (let x = (y / 6) % 2 ? 4 : 1; x < 100; x += 6) { ell(ctx, x, y, y / 70, y / 70); ctx.fill(); }

  // villain collar spikes behind the head
  if (!hero && top !== 'hood') {
    ctx.fillStyle = acc; ctx.globalAlpha = .9;
    ctx.beginPath(); ctx.moveTo(22, 78); ctx.lineTo(28, 46); ctx.lineTo(40, 70); ctx.lineTo(60, 70); ctx.lineTo(72, 46); ctx.lineTo(78, 78); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // hood back
  if (top === 'hood') { ctx.fillStyle = suit; ell(ctx, 50, 50, 27, 32); ctx.fill(); }
  // shoulders
  ctx.fillStyle = suit; ell(ctx, 50, 106, 42 * broad, 32); ctx.fill();
  if (hero) { // chest emblem
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(50, 82); ctx.lineTo(58, 90); ctx.lineTo(50, 99); ctx.lineTo(42, 90); ctx.fill();
  } else { // lapels
    ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.moveTo(42, 76); ctx.lineTo(50, 96); ctx.lineTo(58, 76); ctx.fill();
  }
  // neck and head
  ctx.fillStyle = skin; ctx.fillRect(44, 58, 12, 16);
  ell(ctx, 50, 45, 16.5 * (arch === 'brute' ? 1.08 : 1), 20); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.12)'; ell(ctx, 56, 48, 9, 16); ctx.fill(); // cheek shade
  // ears
  ctx.fillStyle = skin; ell(ctx, 34, 47, 3, 5); ctx.fill(); ell(ctx, 66, 47, 3, 5); ctx.fill();

  // headgear
  ctx.fillStyle = hair;
  if (top === 'slick') { ctx.beginPath(); ctx.ellipse(50, 34, 18, 11, 0, Math.PI, 0); ctx.lineTo(68, 40); ctx.quadraticCurveTo(50, 28, 33, 40); ctx.fill(); ctx.beginPath(); ctx.moveTo(48, 30); ctx.quadraticCurveTo(44, 40, 50, 42); ctx.lineTo(50, 30); ctx.fill(); }
  if (top === 'flat') { ctx.beginPath(); ctx.ellipse(50, 33, 18, 10, 0, Math.PI, 0); ctx.fill(); ctx.fillRect(32, 32, 36, 5); }
  if (top === 'spiky') { ctx.beginPath(); ctx.moveTo(32, 38); for (let i = 0; i <= 6; i++) { ctx.lineTo(32 + i * 6, 20 + (i % 2) * 8 - (i === 3 ? 4 : 0)); ctx.lineTo(35 + i * 6, 34); } ctx.lineTo(68, 38); ctx.fill(); }
  if (top === 'mohawk') { ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(45, 30); for (let i = 0; i < 5; i++) { ctx.lineTo(46 + i * 2, 12 + i * 2); ctx.lineTo(48 + i * 2, 28); } ctx.lineTo(56, 32); ctx.fill(); }
  if (top === 'horns') {
    ctx.fillStyle = '#e9dcc0';
    ctx.beginPath(); ctx.moveTo(36, 34); ctx.quadraticCurveTo(22, 26, 24, 10); ctx.quadraticCurveTo(30, 24, 41, 29); ctx.fill();
    ctx.beginPath(); ctx.moveTo(64, 34); ctx.quadraticCurveTo(78, 26, 76, 10); ctx.quadraticCurveTo(70, 24, 59, 29); ctx.fill();
    ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(50, 33, 16, 7, 0, Math.PI, 0); ctx.fill();
  }
  if (top === 'tophat') {
    ctx.fillStyle = '#111'; ctx.fillRect(28, 27, 44, 5); ctx.fillRect(36, 6, 28, 22);
    ctx.fillStyle = acc; ctx.fillRect(36, 22, 28, 4);
  }
  if (top === 'helmet') {
    const metal = hero ? suit : '#7a7f8c';
    ctx.fillStyle = metal; ctx.beginPath(); ctx.ellipse(50, 40, 19, 19, 0, Math.PI, 0); ctx.lineTo(69, 46); ctx.lineTo(31, 46); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(38, 26, 4, 14);
    ctx.fillStyle = acc; ctx.beginPath(); ctx.moveTo(47, 21); ctx.lineTo(50, 8); ctx.lineTo(53, 21); ctx.fill();
  }
  if (top === 'hood') {
    ctx.fillStyle = suit; ctx.beginPath(); ctx.moveTo(30, 60); ctx.quadraticCurveTo(26, 22, 50, 20); ctx.quadraticCurveTo(74, 22, 70, 60); ctx.quadraticCurveTo(66, 36, 50, 33); ctx.quadraticCurveTo(34, 36, 30, 60); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(50, 36, 16, 6, 0, 0, Math.PI); ctx.fill();
  }

  // eyes and masks
  const eyeY = 46;
  const glow = (c, b) => { ctx.shadowColor = c; ctx.shadowBlur = b; };
  if (mask === 'domino') { ctx.fillStyle = hero ? '#111' : acc; ctx.beginPath(); ctx.ellipse(50, eyeY, 17, 5.5, 0, 0, Math.PI * 2); ctx.fill(); }
  if (mask === 'skull') { ctx.fillStyle = 'rgba(240,240,230,.9)'; ell(ctx, 50, 44, 15, 15); ctx.fill(); ctx.fillStyle = '#111'; ell(ctx, 44, eyeY, 4.5, 4); ctx.fill(); ell(ctx, 56, eyeY, 4.5, 4); ctx.fill(); }
  if (mask === 'visor') {
    ctx.fillStyle = '#111'; ctx.fillRect(32, eyeY - 4, 36, 8);
    glow(acc, 8); ctx.fillStyle = acc; ctx.fillRect(34, eyeY - 1.5, 32, 3); ctx.shadowBlur = 0;
  } else if (mask === 'goggles') {
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(32, eyeY - 2, 36, 4);
    ctx.fillStyle = '#222'; ell(ctx, 43, eyeY, 6, 6); ctx.fill(); ell(ctx, 57, eyeY, 6, 6); ctx.fill();
    glow(acc, 6); ctx.fillStyle = acc; ell(ctx, 43, eyeY, 3.5, 3.5); ctx.fill(); ell(ctx, 57, eyeY, 3.5, 3.5); ctx.fill(); ctx.shadowBlur = 0;
  } else if (mask !== 'skull') {
    if (hero) {
      ctx.fillStyle = '#fff'; ell(ctx, 44, eyeY, 3.6, 2.4); ctx.fill(); ell(ctx, 56, eyeY, 3.6, 2.4); ctx.fill();
      ctx.fillStyle = '#1a2a4a'; ell(ctx, 44, eyeY, 1.5, 1.8); ctx.fill(); ell(ctx, 56, eyeY, 1.5, 1.8); ctx.fill();
    } else {
      glow(acc, 6); ctx.fillStyle = acc;
      ctx.beginPath(); ctx.moveTo(39, eyeY - 1); ctx.lineTo(48, eyeY + 1); ctx.lineTo(39, eyeY + 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(61, eyeY - 1); ctx.lineTo(52, eyeY + 1); ctx.lineTo(61, eyeY + 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }
  if (mask === 'monocle') { ctx.strokeStyle = '#e8c46a'; ctx.lineWidth = 1.6; ell(ctx, 56, eyeY, 5.5, 5.5); ctx.stroke(); ctx.beginPath(); ctx.moveTo(61, eyeY + 3); ctx.quadraticCurveTo(66, 60, 62, 72); ctx.stroke(); }
  // brows: villains scowl, heroes look determined
  ctx.strokeStyle = hero ? '#2a1a10' : '#111'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
  if (mask !== 'visor' && mask !== 'skull' && top !== 'helmet') {
    ctx.beginPath(); ctx.moveTo(38, eyeY - (hero ? 6 : 8)); ctx.lineTo(47, eyeY - 4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(62, eyeY - (hero ? 6 : 8)); ctx.lineTo(53, eyeY - 4); ctx.stroke();
  }
  // mouth
  const mouth = hero ? P(['smile', 'line']) : P(['smirk', 'grin', 'smirk', 'line']);
  ctx.strokeStyle = 'rgba(40,10,10,.85)'; ctx.lineWidth = 1.8;
  if (mouth === 'smirk') { ctx.beginPath(); ctx.moveTo(43, 56); ctx.quadraticCurveTo(52, 58, 58, 53); ctx.stroke(); }
  if (mouth === 'line') { ctx.beginPath(); ctx.moveTo(44, 56); ctx.lineTo(56, 56); ctx.stroke(); }
  if (mouth === 'smile') { ctx.beginPath(); ctx.moveTo(43, 54); ctx.quadraticCurveTo(50, 60, 57, 54); ctx.stroke(); }
  if (mouth === 'grin') {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(41, 54); ctx.quadraticCurveTo(50, 62, 59, 54); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = .8; for (let x = 44; x < 58; x += 3) { ctx.beginPath(); ctx.moveTo(x, 54.5); ctx.lineTo(x, 57.5); ctx.stroke(); }
  }
  // extras: villain mustache or scar
  if (!hero && r() < .3) { ctx.fillStyle = hair; ctx.beginPath(); ctx.moveTo(50, 52); ctx.quadraticCurveTo(40, 49, 36, 55); ctx.quadraticCurveTo(42, 52, 50, 54); ctx.quadraticCurveTo(58, 52, 64, 55); ctx.quadraticCurveTo(60, 49, 50, 52); ctx.fill(); }
  if (!hero && r() < .25) { ctx.strokeStyle = 'rgba(120,20,20,.7)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(58, 38); ctx.lineTo(63, 52); ctx.stroke(); for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(58.5 + i * 1.8, 42 + i * 4); ctx.lineTo(62.5 + i * 1.8, 41 + i * 4); ctx.stroke(); } }
}

const cache = new Map();
function portraitCanvas(seed, kind, arch, px) {
  const key = [seed, kind, arch, px].join('|');
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = px;
  const ctx = c.getContext('2d');
  ctx.scale(px / 100, px / 100);
  drawPortrait(ctx, seed, kind, arch);
  cache.set(key, c);
  return c;
}

// Paint every <canvas class="portrait" data-seed data-kind data-arch> inside root.
function paintPortraits(root = document) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  root.querySelectorAll('canvas.portrait').forEach(cv => {
    const size = +cv.dataset.size || 48;
    const px = Math.round(size * dpr);
    if (cv.width !== px) { cv.width = cv.height = px; }
    const src = portraitCanvas(cv.dataset.seed || '?', cv.dataset.kind || 'villain', cv.dataset.arch || '', px);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(src, 0, 0);
  });
}
function portraitTag(seed, opts = {}) {
  const size = opts.size || 48;
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  return `<canvas class="portrait ${opts.cls || ''}" data-seed="${esc(seed)}" data-kind="${opts.kind || 'villain'}" data-arch="${opts.arch || ''}" data-size="${size}" width="${size}" height="${size}" style="width:${size}px;height:${size}px" aria-hidden="true"></canvas>`;
}

// ---------- District scenes ----------
// Each scene is an illustration (img/) with a transparent canvas of moving light on top.
function stars(ctx, w, h, t, n, seed, top = 1) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x = r() * w, y = r() * h * top, s = r() * 1.6 + .4, ph = r() * 6, sp = .6 + r() * 1.6;
    ctx.globalAlpha = Math.max(0, Math.sin(t * sp + ph)) * .9;
    ctx.fillStyle = '#fff'; ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;
}
function drift(ctx, w, h, t, n, seed, color, rise) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const x0 = r() * w, sp = 8 + r() * 20, ph = r() * 100, size = 1 + r() * 2.2;
    const y = h - ((t * sp + ph * 7) % (h * rise));
    const x = x0 + Math.sin(t * .8 + ph) * 10;
    ctx.globalAlpha = Math.min(1, (h - y) / 30) * (1 - (h - y) / (h * rise));
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 6;
    ell(ctx, x, y, size, size); ctx.fill();
  }
  ctx.shadowBlur = 0; ctx.globalAlpha = 1;
}
const SCENES = {
  docks(ctx, w, h, t) {
    const r = rng('glints');
    for (let i = 0; i < 60; i++) { // sun glints on the water
      const x = w * (.35 + r() * .3) + (r() - .5) * w * .2, y = h * (.66 + r() * .3), ph = r() * 6;
      ctx.globalAlpha = Math.max(0, Math.sin(t * (1.5 + r() * 2) + ph)) * .8;
      ctx.fillStyle = '#ffd9a0'; ctx.fillRect(x, y, 6 + r() * 10, 1.5);
    }
    ctx.globalAlpha = 1;
    drift(ctx, w, h, t, 14, 'dock-mist', 'rgba(255,200,150,.6)', .6);
  },
  neon(ctx, w, h, t) {
    ctx.strokeStyle = 'rgba(190,210,255,.35)'; ctx.lineWidth = 1;
    const r = rng('rain');
    for (let i = 0; i < 140; i++) {
      const x = (r() * w + t * 70) % w, y = (r() * h + t * (300 + r() * 120)) % h;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 12); ctx.stroke();
    }
    const flick = Math.sin(t * 7) > .93 || Math.sin(t * 2.3 + 1) > .985;
    if (flick) { ctx.fillStyle = 'rgba(255,63,164,.08)'; ctx.fillRect(0, 0, w, h); }
  },
  capitol(ctx, w, h, t) {
    for (let i = 0; i < 2; i++) { // searchlights
      const ox = w * (.22 + i * .56), a = Math.sin(t * .45 + i * 2.2) * .55;
      ctx.save(); ctx.translate(ox, h * .85); ctx.rotate(a);
      const g = ctx.createLinearGradient(0, 0, 0, -h * 1.3);
      g.addColorStop(0, 'rgba(255,240,200,.32)'); g.addColorStop(1, 'rgba(255,240,200,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-3, 0); ctx.lineTo(-38, -h * 1.3); ctx.lineTo(38, -h * 1.3); ctx.lineTo(3, 0); ctx.fill();
      ctx.restore();
    }
  },
  orbit(ctx, w, h, t) {
    stars(ctx, w, h, t, 70, 'orbit', .7);
    const x = ((t * 40) % (w + 200)) - 100, y = h * .25 + Math.sin(t * .3) * 10;
    ctx.fillStyle = '#ff4d6a'; ctx.globalAlpha = .5 + .5 * Math.abs(Math.sin(t * 4));
    ell(ctx, x, y, 2, 2); ctx.fill(); ctx.globalAlpha = 1;
  },
  moon(ctx, w, h, t) {
    stars(ctx, w, h, t, 60, 'moon', .55);
    drift(ctx, w, h, t, 10, 'moondust', 'rgba(220,200,255,.5)', .35);
  },
  keyart(ctx, w, h, t) {
    drift(ctx, w, h, t, 36, 'embers', '#ff8a1f', .9);
  },
};

let sceneRaf = 0;
const t0 = performance.now();
// Safe to call after every render: starts the loop only if it isn't already running.
function runScenes() {
  if (sceneRaf) return;
  const frame = now => {
    const list = document.querySelectorAll('canvas.scene');
    if (!list.length) { sceneRaf = 0; return; }
    const t = reduceMotion() ? 2 : (now - t0) / 1000;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    list.forEach(cv => {
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!reduceMotion()) (SCENES[cv.dataset.scene] || (() => {}))(ctx, w, h, t);
    });
    sceneRaf = reduceMotion() ? 0 : requestAnimationFrame(frame);
  };
  sceneRaf = requestAnimationFrame(frame);
}
// The page re-renders often; a negative delay keeps the slow camera drift continuous across re-renders.
function sceneTag(id, cls = '') {
  const delay = -(((performance.now() - t0) / 1000) % 60).toFixed(2);
  const src = id === 'keyart' ? 'img/keyart.webp' : `img/district-${id}.webp`;
  return `<img class="scene-img" src="${src}" alt="" style="animation-delay:${delay}s" decoding="async"><canvas class="scene ${cls}" data-scene="${id}" aria-hidden="true"></canvas>`;
}

// ---------- Item icons (inline SVG) ----------
const ICON_PATHS = {
  weapon: '<path d="M5 19 L15 9 M13 7 L17 3 L21 7 L17 11 Z M4 16 L8 20 M6 22 L2 18"/>',
  armor: '<path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z"/><path d="M12 7 V17 M8 11 H16"/>',
  vehicle: '<path d="M3 15 V11 L6 7 H15 L19 11 H21 V15 Z"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
};
function itemIcon(type, loot) {
  return `<span class="item-icon ${loot ? 'loot' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[type] || ''}</svg></span>`;
}

// ---------- Effects ----------
let fxCanvas, fxCtx, parts = [], fxRaf = 0;
function fxLoop() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = innerWidth, h = innerHeight;
  if (fxCanvas.width !== Math.round(w * dpr)) { fxCanvas.width = Math.round(w * dpr); fxCanvas.height = Math.round(h * dpr); }
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fxCtx.clearRect(0, 0, w, h);
  parts = parts.filter(p => p.life > 0);
  for (const p of parts) {
    p.life -= 1; p.x += p.vx; p.y += p.vy; p.vy += .12; p.vx *= .985; p.rot += p.vr;
    fxCtx.save(); fxCtx.globalAlpha = Math.min(1, p.life / 30); fxCtx.translate(p.x, p.y); fxCtx.rotate(p.rot);
    fxCtx.fillStyle = p.c;
    if (p.star) { fxCtx.beginPath(); for (let i = 0; i < 5; i++) { fxCtx.lineTo(0, -p.s); fxCtx.rotate(Math.PI / 5); fxCtx.lineTo(0, -p.s * .45); fxCtx.rotate(Math.PI / 5); } fxCtx.fill(); }
    else fxCtx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    fxCtx.restore();
  }
  fxRaf = parts.length ? requestAnimationFrame(fxLoop) : 0;
  if (!parts.length) fxCtx.clearRect(0, 0, w, h);
}
function burst(x, y, colors = ['#ff8a1f', '#c46bff', '#ffd23f', '#4dd6ff'], n = 70) {
  if (reduceMotion()) return;
  if (!fxCanvas) {
    fxCanvas = document.createElement('canvas'); fxCanvas.className = 'fx-canvas'; fxCanvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(fxCanvas); fxCtx = fxCanvas.getContext('2d');
  }
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 3, life: 60 + Math.random() * 40, c: colors[i % colors.length], s: 5 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - .5) * .4, star: Math.random() < .3 });
  }
  if (!fxRaf) fxRaf = requestAnimationFrame(fxLoop);
}
function floatText(x, y, text, cls = '', delay = 0) {
  const el = document.createElement('div');
  el.className = 'float-text ' + cls;
  el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  el.style.animationDelay = delay + 'ms';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1600 + delay);
}
function shake(el) {
  if (!el || reduceMotion()) return;
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 500);
}
function banner(title, sub = '', cls = '') {
  const el = document.createElement('div');
  el.className = 'fx-banner ' + cls;
  el.innerHTML = `<div class="fx-banner-in"><b></b><span></span></div>`;
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = sub;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2200);
  burst(innerWidth / 2, innerHeight * .42, undefined, 110);
}
function tween(from, to, ms, onStep) {
  if (reduceMotion() || from === to) return onStep(to, true);
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    onStep(from + (to - from) * e, k === 1);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

window.Art = { portraitTag, paintPortraits, sceneTag, runScenes, itemIcon, burst, floatText, shake, banner, tween, reduceMotion };
})();
