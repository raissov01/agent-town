'use strict';
// =====================================================================
// Agent Town — нақты агенттердің пиксель-қалашығы
// =====================================================================
const S = 3, T = 8, GW = 64, GH = 36;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------- карта ----------------
// 0 шөп, 1 жол, 2 еден, 3 қабырға, 4 жиһаз
const G = Array.from({ length: GH }, () => new Array(GW).fill(0));
const fill = (x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (G[y] && x >= 0 && x < GW) G[y][x] = v; };
fill(0, 13, GW, 2, 1); fill(0, 26, GW, 2, 1);
for (const x of [15, 31, 47]) fill(x, 0, 2, 28, 1);

function room(x, y, w, h, door) {
  fill(x, y, w, h, 3); fill(x + 1, y + 1, w - 2, h - 2, 2);
  G[door.y][door.x] = 2;
  return { x, y, w, h, door };
}
const OFFICE_POS = [[1, 2], [17, 2], [33, 2], [1, 15], [17, 15], [33, 15]];
const offices = OFFICE_POS.map(([x, y], i) => {
  const r = room(x, y, 14, 11, { x: x + 7, y: y + 10 });
  r.i = i; r.desks = [];
  for (const [dx, dy] of [[2, 2], [8, 2], [2, 6], [8, 6]]) {
    fill(x + dx, y + dy, 4, 2, 4);
    r.desks.push({ x: x + dx, y: y + dy, seat: { x: x + dx + 2, y: y + dy + 2 } });
  }
  fill(x + 12, y + 1, 1, 1, 4); // өсімдік
  return r;
});
const cafe = room(49, 2, 14, 11, { x: 55, y: 12 });
fill(50, 3, 12, 2, 4); // бар-стойка
const cafeSeats = [];
for (const ty of [7, 10]) for (const tx of [52, 56, 60]) { G[ty][tx] = 4; cafeSeats.push({ x: tx - 1, y: ty }, { x: tx + 1, y: ty }); }
const hall = room(49, 15, 14, 11, { x: 55, y: 25 });
fill(52, 18, 8, 4, 4);
const hallSeats = [];
for (const x of [52, 55, 58]) hallSeats.push({ x, y: 17 }, { x, y: 22 }); // көпіршіктер қабаттаспасын — арасы 3 тор
const dorm = room(49, 28, 14, 8, { x: 56, y: 28 });
const beds = [];
for (const by of [29, 33]) for (const bx of [50, 53, 58]) { fill(bx, by, 3, 2, 4); beds.push({ x: bx, y: by, spot: { x: bx + 1, y: by === 29 ? 31 : 32 } }); }
const CLOUD_PODS = [0, 1, 2, 3, 4, 5].map(i => ({ x: 5 + i * 7, y: 32 }));
const TREES = [[3, 0], [10, 0], [21, 0], [26, 0], [38, 0], [44, 0], [52, 0], [59, 0], [0, 29], [46, 29], [46, 34], [0, 34], [13, 29], [33, 29]];
const LAMPS = [[14, 12], [30, 12], [46, 12], [14, 25], [30, 25], [46, 25], [63, 12], [63, 25]];

const walkable = (x, y) => y >= 0 && y < GH && x >= 0 && x < GW && G[y][x] <= 2;
function bfs(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [];
  const key = (x, y) => y * GW + x, prev = new Map([[key(sx, sy), -1]]), q = [[sx, sy]];
  let head = 0;
  while (head < q.length) {
    const [x, y] = q[head++];
    if (x === tx && y === ty) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = key(nx, ny);
      if (prev.has(k)) continue;
      if (!walkable(nx, ny) && !(nx === tx && ny === ty)) continue;
      prev.set(k, key(x, y)); q.push([nx, ny]);
    }
  }
  const path = []; let k = key(tx, ty);
  if (!prev.has(k)) return [];
  while (k !== -1) { path.unshift({ x: k % GW, y: Math.floor(k / GW) }); k = prev.get(k); }
  path.shift(); return path;
}

// ---------------- түстер ----------------
const SHIRTS = ['#e0564f', '#4f8fe0', '#5fbf6a', '#e0b84f', '#a46fe0', '#4fd1c5', '#e07a3f', '#d6d6d6', '#e06fa8', '#8fbf3f'];
const HAIRS = ['#3b2a20', '#141414', '#7a4b2a', '#2b1d14', '#d9d0c0', '#5a2e1e', '#1f1f2a', '#8a5a3a'];
const SKINS = ['#f1c7a1', '#d9a77c', '#f3d2b0', '#c58d62', '#e3b58e', '#a8714a'];
const PANTS = ['#2f3a56', '#3a3a3a', '#2d3b2f', '#4a3b2a', '#2a2a3f', '#30343c'];
const OFFICE_FLOORS = [['#c9a77c', '#c29f73'], ['#b9c4d0', '#b2bdca'], ['#cfd8d0', '#c6d0c7'], ['#d6c3a5', '#cdb99a'], ['#c4b8d2', '#bcafca'], ['#bfcfc0', '#b6c7b7']];
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function look(id) { const h = hash(id); return { shirt: SHIRTS[h % SHIRTS.length], hair: HAIRS[(h >> 4) % HAIRS.length], skin: SKINS[(h >> 8) % SKINS.length], pants: PANTS[(h >> 12) % PANTS.length] }; }
const energyColor = e => e > 0.5 ? '#5fbf6a' : e > 0.2 ? '#e0b84f' : '#e0564f';

const KZ = { type: 'код жазуда', read: 'файл оқуда', terminal: 'терминалда', browse: 'интернетте', think: 'ойлануда', meeting: 'сабагентке тапсырма берді', wait: 'сізді күтуде', home: 'үйде (белсенді емес)', sleep: 'ұйықтап жатыр (энергия бітті)' };
const EVC = { prompt: '#e6e6e6', type: '#7fd1ff', read: '#c9b98e', terminal: '#5fe07a', browse: '#4f8fe0', meeting: '#a46fe0', plan: '#e0b84f', say: '#9aa0ab', error: '#e0564f', fail: '#e0564f', pass: '#5fbf6a', think: '#9aa0ab' };

// ---------------- күй ----------------
let snap = { online: false, state: null, results: [] };
const sprites = new Map(); // id -> sprite
let officeOf = new Map();  // project cwd -> office index
let selected = null;
let lastResults = new Set();

function assignOffices(agents) {
  const latest = new Map();
  // кеңсе тек белсенді агенті бар жобаға беріледі (үйдегі/ұйықтағандарға керек емес)
  for (const a of agents) if (!['home', 'sleep'].includes(a.state)) latest.set(a.project, Math.max(latest.get(a.project) || 0, a.lastTs));
  const keep = new Map();
  // бұрынғы кеңсесін сақтаймыз (жоба «көшіп» жүрмесін)
  for (const [k, i] of officeOf) if (latest.has(k) && i < 5) keep.set(k, i);
  const used = new Set(keep.values());
  for (const [k] of [...latest.entries()].sort((a, b) => b[1] - a[1])) {
    if (keep.has(k)) continue;
    let free = [0, 1, 2, 3, 4].find(i => !used.has(i));
    if (free === undefined) free = 5; // қалғандары — «Басқа жобалар»
    keep.set(k, free); if (free < 5) used.add(free);
  }
  officeOf = keep;
}

function slotFor(s, kind, list) {
  const taken = new Set([...sprites.values()].filter(o => o !== s && o[kind] !== undefined).map(o => o[kind]));
  if (s[kind] !== undefined && !taken.has(s[kind])) return s[kind];
  for (let i = 0; i < list.length; i++) if (!taken.has(i)) return i;
  return hash(s.id) % list.length;
}

function syncAgents() {
  const st = snap.state; const agents = (st && st.agents) || [];
  assignOffices(agents);
  const ids = new Set();
  // кеңседегі үстелдер
  const deskUse = offices.map(() => new Set());
  for (const a of agents) {
    ids.add(a.id);
    let s = sprites.get(a.id);
    if (!s) {
      s = { id: a.id, c: look(a.id), path: [], goal: null, dir: 'down', fx: [] };
      const b = beds[hash(a.id) % beds.length].spot;
      s.px = b.x * T + 4; s.py = b.y * T + 7;
      sprites.set(a.id, s);
    }
    s.a = a;
    s.office = officeOf.get(a.project) ?? 5;
  }
  for (const [id] of sprites) if (!ids.has(id)) { sprites.delete(id); if (selected === id) closeDrawer(); }
  // үстел тағайындау: өз кеңсесінде бос үстел; болмаса кафеге
  const list = [...sprites.values()].sort((x, y) => x.id < y.id ? -1 : 1);
  for (const s of list) {
    const used = deskUse[s.office];
    let d = s.desk !== undefined && s.deskOffice === s.office && !used.has(s.desk) ? s.desk : [0, 1, 2, 3].find(i => !used.has(i));
    if (d === undefined) { s.desk = undefined; continue; }
    used.add(d); s.desk = d; s.deskOffice = s.office;
  }
  for (const s of list) {
    s.cafe = slotFor(s, 'cafe', cafeSeats);
    s.bed = slotFor(s, 'bed', beds);
    const g = targetFor(s);
    if (!s.goal || s.goal.x !== g.x || s.goal.y !== g.y) {
      s.goal = g; s.path = bfs(Math.floor(s.px / T), Math.floor(s.py / T), g.x, g.y);
    }
  }
  // сабагенттер — мәжіліс залында
  syncHelpers(agents);
}
function targetFor(s) {
  const st = s.a.state;
  if (st === 'home') return beds[s.bed].spot;
  if (st === 'sleep') return beds[s.bed].spot;
  if (st === 'wait' || s.desk === undefined) return cafeSeats[s.cafe];
  return offices[s.office].desks[s.desk].seat;
}

const helpers = new Map(); // id -> sprite
function syncHelpers(agents) {
  const want = [];
  for (const a of agents) for (const sa of a.subagents || []) want.push({ ...sa, parent: a.id, key: a.id + ':' + sa.id });
  const ids = new Set(want.map(w => w.key));
  for (const [k] of helpers) if (!ids.has(k)) helpers.delete(k);
  want.slice(0, hallSeats.length).forEach((w, i) => {
    let h = helpers.get(w.key);
    const parent = sprites.get(w.parent);
    if (!h) {
      h = { id: w.key, c: parent ? { ...look(w.key), shirt: parent.c.shirt } : look(w.key), path: [], dir: 'down', helper: true, fx: [] };
      // ата-агенттің жанынан шығады
      h.px = parent ? parent.px : hall.door.x * T + 4; h.py = parent ? parent.py : (hall.door.y + 1) * T + 7;
      helpers.set(w.key, h);
    }
    h.a = { ...w, energy: 1 };
    const seat = hallSeats[i];
    if (!h.goal || h.goal.x !== seat.x || h.goal.y !== seat.y) { h.goal = seat; h.path = bfs(Math.floor(h.px / T), Math.floor(h.py / T), seat.x, seat.y); }
  });
}

// ---------------- сурет салу ----------------
const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
const FONT = '"IBM Plex Mono", "DejaVu Sans Mono", ui-monospace, monospace';
function text(t, x, y, size, color, align = 'left', bold = true) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `${bold ? 'bold ' : ''}${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(t, x * S, y * S); ctx.restore();
}
function fitText(t, maxPx, size) {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = `bold ${size}px ${FONT}`;
  let s = String(t); while (s.length > 1 && ctx.measureText(s).width > maxPx) s = s.slice(0, -1);
  ctx.restore(); return s === String(t) ? s : s.slice(0, -1) + '…';
}
const HOUR_OVERRIDE = new URLSearchParams(location.search).get('hour'); // ?hour=14 — скриншот үшін
const hour = () => { if (HOUR_OVERRIDE !== null) return +HOUR_OVERRIDE; const d = new Date(); return d.getHours() + d.getMinutes() / 60; };
function nightAlpha() { const h = hour(); if (h < 5 || h >= 22) return 0.28; if (h < 7) return 0.28 * (7 - h) / 2; if (h >= 18) return 0.28 * (h - 18) / 4; return 0; }

function floorAt(x, y) {
  for (const o of offices) if (x > o.x && x < o.x + o.w - 1 && y > o.y && y < o.y + o.h - 1 || (x === o.door.x && y === o.door.y)) return OFFICE_FLOORS[o.i][(x + y) % 2];
  if (inRoom(cafe, x, y)) return (x + y) % 2 ? '#d9b48f' : '#d1ab85';
  if (inRoom(hall, x, y)) return (x + y) % 2 ? '#b8a690' : '#b09d86';
  if (inRoom(dorm, x, y)) return (x + y) % 2 ? '#7f8fa6' : '#7889a0';
  return '#c29f73';
}
function inRoom(r, x, y) { return (x > r.x && x < r.x + r.w - 1 && y > r.y && y < r.y + r.h - 1) || (x === r.door.x && y === r.door.y); }

let staticLayer = null;
function drawStatic() {
  staticLayer = document.createElement('canvas'); staticLayer.width = GW * T; staticLayer.height = GH * T;
  const c = staticLayer.getContext('2d');
  const r = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
    const v = G[y][x], X = x * T, Y = y * T;
    if (v === 0) r(X, Y, T, T, (x * 7 + y * 3) % 5 ? '#6fae5a' : '#69a654');
    else if (v === 1) r(X, Y, T, T, '#8b8f99');
    else if (v === 3) { r(X, Y, T, T, '#5b6475'); r(X, Y, T, 2, '#6f7a8d'); }
    else r(X, Y, T, T, floorAt(x, y));
  }
  // жол белгілері
  for (let x = 0; x < GW * T; x += 8) for (const yy of [13, 26]) if (![15, 16, 31, 32, 47, 48].includes(Math.floor(x / T))) r(x + 1, yy * T + 7, 4, 1, '#d6d6d6');
  for (const xx of [15, 31, 47]) for (let y = 0; y < 26 * T; y += 8) if (![13, 14].includes(Math.floor(y / T))) r(xx * T + 7, y + 1, 1, 4, '#d6d6d6');
  // ағаштар
  for (const [x, y] of TREES) if (G[y][x] === 0) { r(x * T + 3, y * T + 5, 2, 3, '#7a4b2a'); r(x * T, y * T, 8, 6, '#3f8f4f'); r(x * T + 2, y * T - 1, 4, 2, '#4fa85f'); }
  // бұлт алаңы
  r(2, 29 * T + 2, 44 * T, 6 * T + 4, '#7fb069');
  for (let i = 0; i < 44; i += 2) r(2 + i * T, 35 * T + 4, T, 2, '#6a9a58');
  // кафе: стойка, кофе машина
  r(50 * T, 3 * T, 12 * T, 16, '#6b4a2f'); r(50 * T, 3 * T, 12 * T, 3, '#8a6240');
  r(51 * T, 3 * T - 6, 10, 10, '#2a2a2a'); r(53 * T, 3 * T - 4, 6, 4, '#e6e6e6');
  for (let i = 0; i < 5; i++) r(56 * T + i * 8, 3 * T + 4, 4, 5, ['#e0564f', '#4f8fe0', '#e0b84f', '#5fbf6a', '#a46fe0'][i]);
  for (const ty of [7, 10]) for (const tx of [52, 56, 60]) { r(tx * T, ty * T + 1, T, T - 2, '#8a6240'); r(tx * T + 3, ty * T + 3, 2, 2, '#e6e6e6'); }
  // мәжіліс үстелі
  r(52 * T, 18 * T, 64, 32, '#8a6240'); r(52 * T + 1, 18 * T + 1, 62, 30, '#9b7048'); r(54 * T, 19 * T + 4, 32, 14, '#e6e6e6'); r(54 * T + 2, 19 * T + 6, 20, 1, '#4f8fe0'); r(54 * T + 2, 19 * T + 9, 26, 1, '#9aa0ab'); r(54 * T + 2, 19 * T + 12, 14, 1, '#9aa0ab');
  // кеңсе үстелдері
  for (const o of offices) {
    for (const d of o.desks) {
      const x = d.x * T, y = d.y * T;
      r(x, y + 2, 32, 12, '#6b4a2f'); r(x, y + 2, 32, 2, '#8a6240'); r(x, y + 13, 32, 1, '#3e2a1a');
      r(x + 1, y + 14, 2, 2, '#3e2a1a'); r(x + 29, y + 14, 2, 2, '#3e2a1a');
      r(d.seat.x * T + 1, d.seat.y * T + 3, 6, 4, '#2f3440');
    }
    const px = (o.x + 12) * T, py = (o.y + 1) * T; r(px + 1, py + 4, 6, 4, '#7a4b2a'); r(px, py - 2, 8, 6, '#3f8f4f');
  }
  // жатақхана төсектері
  for (const b of beds) { const x = b.x * T, y = b.y * T; r(x, y, 24, 16, '#5a3e2a'); r(x + 1, y + 1, 22, 14, '#e6e6e6'); r(x + 2, y + 3, 5, 10, '#d0d6de'); r(x + 8, y + 1, 15, 14, '#9aa6b8'); }
}

function drawLabels() {
  offices.forEach(o => {
    const proj = [...officeOf.entries()].filter(([, i]) => i === o.i).map(([k]) => k);
    const name = o.i === 5 ? (proj.length ? 'басқа жобалар' : '') : (proj[0] || '');
    if (name) text(fitText(name, 12 * T * S - 8, 20), (o.x + 1) * T, o.y * T + 7, 20, '#e6e6e6');
    else text('бос кеңсе', (o.x + 1) * T, o.y * T + 7, 20, '#8c93a0');
  });
  text('КАФЕ', 50 * T, 2 * T + 7, 20, '#e6e6e6');
  text('МӘЖІЛІС', 50 * T, 15 * T + 7, 20, '#e6e6e6');
  text('ҮЙ', 50 * T, 28 * T + 7, 20, '#e6e6e6');
  text('БҰЛТ', 2, 29 * T + 9, 20, '#ffffff');
}

// код «миникартасы»: нақты код жолдарын түсті блок етіп салады
function tokColor(l) {
  const s = l.trim();
  if (/^(\/\/|#|\*|<!--)/.test(s)) return '#6a7383';
  if (/^(import|export|const|let|var|function|return|if|for|while|class|def|func|package|async|await|type|interface|from|else|switch|case)\b/.test(s)) return '#c792ea';
  if (/^['"`<]/.test(s)) return '#9ad37f';
  if (/^[})\]]/.test(s)) return '#89ddff';
  return '#82aaff';
}
function drawScreen(x, y, w, h, a, t, flash) {
  const st = a.state;
  let bg = '#2b3340';
  const working = !['wait', 'home', 'sleep'].includes(st);
  if (working) bg = st === 'terminal' ? '#0d1a10' : st === 'browse' ? '#eef2f6' : st === 'read' ? '#f4efe0' : '#1b2233';
  if (flash === 'err') bg = '#5a1a1a';
  R(x, y, w, h, bg);
  if (!working) return;
  const rows = Math.floor(h / 2);
  if (st === 'terminal') {
    const lines = (a.out && a.out.length ? a.out : [a.detail || '$']).slice(-rows);
    lines.forEach((l, i) => R(x + 1, y + 1 + i * 2, Math.max(1, Math.min(w - 2, Math.ceil(l.length / 5))), 1, i === lines.length - 1 && Math.floor(t / 400) % 2 ? '#e6e6e6' : '#5fe07a'));
  } else if (st === 'browse') {
    R(x, y, w, 2, '#4f8fe0'); for (let i = 1; i < rows; i++) R(x + 1, y + 1 + i * 2, (i * 5 + 3) % (w - 3) + 2, 1, '#9aa0ab');
  } else if (st === 'read') {
    for (let i = 0; i < rows; i++) R(x + 2, y + 1 + i * 2, w - 4 - ((i * 3) % 5), 1, '#9a8f73');
  } else {
    const code = a.code && a.code.length ? a.code : null;
    const off = code ? Math.floor(t / (st === 'type' ? 500 : 1500)) % Math.max(1, code.length) : 0;
    for (let i = 0; i < rows; i++) {
      if (!code) { R(x + 1, y + 1 + i * 2, 2 + ((i * 7 + Math.floor(t / 300)) % (w - 4)), 1, '#7fd1ff'); continue; }
      const l = code[(off + i) % code.length];
      const indent = Math.min(w - 3, Math.floor((l.length - l.trimStart().length) / 2));
      const len = Math.min(w - 2 - indent, Math.ceil(l.trim().length / 4));
      if (len > 0) R(x + 1 + indent, y + 1 + i * 2, len, 1, tokColor(l));
    }
    if (st === 'type' && Math.floor(t / 300) % 2) R(x + w - 2, y + h - 3, 1, 2, '#e6e6e6');
  }
}

function drawOffices(t) {
  const now = Date.now();
  const usedOffices = new Set(officeOf.values());
  for (const o of offices) {
    if (!usedOffices.has(o.i)) { ctx.globalAlpha = 0.55; R((o.x + 1) * T, (o.y + 1) * T, (o.w - 2) * T, (o.h - 2) * T, '#2a2d34'); ctx.globalAlpha = 1; continue; }
    const members = [...sprites.values()].filter(s => s.office === o.i && s.desk !== undefined);
    o.desks.forEach((d, i) => {
      const s = members.find(m => m.desk === i);
      const x = d.x * T, y = d.y * T;
      R(x + 7, y - 5, 18, 13, '#222'); R(x + 14, y + 8, 4, 2, '#222');
      const sx = x + 8, sy = y - 4;
      if (s && atGoal(s) && !['wait', 'home', 'sleep'].includes(s.a.state)) {
        const flash = now - (s.a.errTs || 0) < 6000 || (s.a.test && !s.a.test.ok && now - s.a.test.ts < 60e3) ? 'err' : null;
        drawScreen(sx, sy, 16, 11, s.a, t, flash);
      } else R(sx, sy, 16, 11, '#2b3340');
      R(x + 26, y + 5, 4, 4, '#ddd');
    });
    // жалау: соңғы 15 минутта commit/push
    const recent = members.concat([...sprites.values()].filter(s => s.office === o.i)).some(s => now - Math.max(s.a.commitTs || 0, s.a.pushTs || 0) < 15 * 60e3);
    if (recent) {
      const fx = (o.x + o.w - 2) * T, fy = o.y * T;
      R(fx + 3, fy - 10, 1, 12, '#3a3e48');
      const wave = Math.floor(t / 300) % 2;
      R(fx + 4, fy - 10, 7, 4 + wave, '#e0564f'); R(fx + 4, fy - 10, 7, 1, '#f07a70');
    }
  }
}

function atGoal(s) { return s.path.length === 0; }

function drawChar(s, t) {
  const a = s.a, c = s.c;
  const x = Math.round(s.px - 4), y = Math.round(s.py - 12);
  const moving = s.path.length > 0;
  if (a.state === 'sleep' && !moving && !s.helper) {
    const b = beds[s.bed], bx = b.x * T, by = b.y * T;
    R(bx + 8, by + 1, 15, 14, c.shirt); R(bx + 8, by + 1, 15, 2, '#00000030');
    R(bx + 2, by + 5, 5, 6, c.skin); R(bx + 1, by + 4, 3, 8, c.hair);
    for (let i = 0; i < 3; i++) { const p = ((t / 1300 + i / 3) % 1); ctx.save(); ctx.globalAlpha = 1 - p; text('z', bx + 6 + p * 10, by + 2 - p * 14, 12 + i * 3, '#ffffff'); ctx.restore(); }
    if (selected === s.id) selBox(bx, by, 24, 16);
    return;
  }
  const atDesk = !moving && !s.helper && s.desk !== undefined && !['wait', 'home', 'sleep'].includes(a.state);
  const back = atDesk;
  const sit = !moving && (atDesk || a.state === 'wait' || s.helper);
  const step = moving ? Math.floor(t / 140) % 2 : 0;
  R(x + 1, y + 12, 6, 1, '#00000040');
  if (sit) R(x + 1, y + 9, 6, 2, c.pants);
  else { R(x + 1 + step, y + 9, 2, 3, c.pants); R(x + 5 - step, y + 9, 2, 3, c.pants); }
  const busy = back && ['type', 'terminal'].includes(a.state);
  const bob = busy ? Math.floor(t / 130) % 2 : 0;
  R(x, y + 5, 8, 5, c.shirt);
  if (busy) { const f = Math.floor(t / (a.state === 'terminal' ? 90 : 140)) % 2; R(x - 1, y + 5 + f, 1, 3, c.shirt); R(x + 8, y + 6 - f, 1, 3, c.shirt); }
  else { R(x - 1, y + 5, 1, 4, c.skin); R(x + 8, y + 5, 1, 4, c.skin); }
  const hy = y + bob;
  if (back || (s.helper && !moving && s.goal && s.goal.y === 22)) { R(x + 1, hy, 6, 5, c.hair); R(x + 1, hy + 4, 6, 1, c.skin); }
  else {
    R(x + 1, hy, 6, 5, c.skin); R(x + 1, hy, 6, 2, c.hair); R(x + 1, hy, 1, 3, c.hair); R(x + 6, hy, 1, 3, c.hair);
    const ex = s.dir === 'left' ? -1 : s.dir === 'right' ? 1 : 0;
    if ((Math.floor(t / 3000) + hash(s.id)) % 6 || t % 3000 > 150) { R(x + 2 + ex, hy + 3, 1, 1, '#1a1a1a'); R(x + 5 + ex, hy + 3, 1, 1, '#1a1a1a'); }
  }
  // Codex — қара кепка, сабагент — сары каска
  if (a.engine === 'codex') { R(x + 1, hy - 1, 6, 2, '#15171b'); R(x + (s.dir === 'left' ? -1 : 5), hy, 3, 1, '#15171b'); }
  if (s.helper) { R(x + 1, hy - 1, 6, 2, '#e0b84f'); R(x + 1, hy, 6, 1, '#c99a2e'); }
  if (a.state === 'read' && back) R(x + 7, y + 4, 4, 5, '#f4efe0');
  if (a.state === 'wait' && !moving) { R(x + 8, y + 5, 3, 3, '#e6e6e6'); R(x + 9, y + 4, 1, 1, '#7a4b2a'); }
  if (a.state === 'home' && !moving) R(x + 6, y + 5, 3, 4, '#222');
  // энергия
  if (!s.helper) { R(x - 2, y - 4, 12, 3, '#15171b'); R(x - 1, y - 3, Math.max(0, Math.round(10 * (a.energy ?? 1))), 1, energyColor(a.energy ?? 1)); }
  if (selected === s.id) selBox(x - 3, y - 5, 14, 19);
  if (!moving) s.bubble = bubbleFor(s, t); else s.bubble = null;
  s.hit = { x: x - 3, y: y - 5, w: 14, h: 19 };
}
function selBox(x, y, w, h) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1 / S * 2; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); }

function bubbleFor(s, t) {
  const a = s.a, now = Date.now();
  if (s.helper) {
    // көмекшілер көп болса, көпіршікті кезекпен көрсетеміз (қабаттаспасын)
    const hs = [...helpers.values()], i = hs.indexOf(s);
    if (hs.length > 1 && Math.floor(t / 2500) % hs.length !== i) return null;
    return { text: String(a.detail || a.title || 'көмекші').replace(/^\$\s*/, ''), kind: 'helper' };
  }
  if (now - (a.errTs || 0) < 8000) return { text: 'қате!', kind: 'err' };
  if (a.test && now - a.test.ts < 8000) return { text: a.test.ok ? 'тест өтті' : 'тест құлады', kind: a.test.ok ? 'ok' : 'err' };
  if (now - (a.pushTs || 0) < 8000) return { text: 'git push', kind: 'ok' };
  if (now - (a.commitTs || 0) < 8000) return { text: 'commit', kind: 'ok' };
  switch (a.state) {
    case 'think': return { text: '.'.repeat(1 + Math.floor(t / 350) % 3).padEnd(3, ' ') };
    case 'wait': return { text: '?', kind: 'wait' };
    case 'home': case 'sleep': return null;
    default: return { text: a.detail || a.tool || '' };
  }
}
function shortName(a) { const t = a.title || a.prompt || a.project || ''; return t.length > 16 ? t.slice(0, 15) + '…' : t; }
function drawNames() {
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.font = `bold 16px ${FONT}`;
  for (const s of sprites.values()) {
    if (!s.hit || s.path.length) continue;
    const a = s.a; if (a.state === 'sleep') continue;
    const txt = shortName(a); if (!txt) continue;
    const w = ctx.measureText(txt).width + 6, cx = (s.hit.x + s.hit.w / 2) * S, X = Math.max(1, Math.min(cv.width - w - 1, cx - w / 2)), Y = (s.hit.y + s.hit.h) * S + 1;
    ctx.fillStyle = selected === s.id ? '#ffffff' : 'rgba(21,23,27,.85)'; ctx.fillRect(X, Y, w, 20);
    ctx.fillStyle = selected === s.id ? '#1a1a1a' : '#e6e6e6'; ctx.fillText(txt, X + 3, Y + 15);
  }
  ctx.restore();
}
function drawBubbles() {
  const all = [...sprites.values(), ...helpers.values()].filter(s => s.bubble && s.bubble.text && s.hit);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `17px ${FONT}`;
  for (const s of all) {
    const sel = selected === s.id;
    const max = sel ? 60 : s.helper ? 24 : 26;
    let txt = String(s.bubble.text); if (txt.length > max) txt = txt.slice(0, max - 1) + '…';
    const w = ctx.measureText(txt).width + 12, h = 24;
    const cx = (s.hit.x + s.hit.w / 2) * S, X = Math.max(2, Math.min(cv.width - w - 2, cx - w / 2)), Y = s.hit.y * S - h - 4;
    const k = s.bubble.kind;
    ctx.fillStyle = k === 'err' ? '#e0564f' : k === 'ok' ? '#5fbf6a' : k === 'helper' ? '#fff4d6' : '#ffffff';
    ctx.fillRect(X, Y, w, h);
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1; ctx.strokeRect(X + .5, Y + .5, w - 1, h - 1);
    ctx.fillRect(cx - 2, Y + h, 4, 3);
    ctx.fillStyle = k === 'err' || k === 'ok' ? '#ffffff' : '#1a1a1a';
    ctx.fillText(txt, X + 6, Y + 17.5);
  }
  ctx.restore();
}

function cloudList() {
  const seen = new Set(), out = [];
  for (const c of [...((snap.state && snap.state.cloud) || []), ...(snap.vpsCloud || [])]) if (!seen.has(c.url)) { seen.add(c.url); out.push(c); }
  return out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
}
function drawCloud(t) {
  const list = cloudList().slice(0, CLOUD_PODS.length);
  const runs = (snap.state && snap.state.runs) || [];
  CLOUD_PODS.forEach((p, i) => {
    const x = p.x * T, y = p.y * T;
    // бұлт платформасы
    const c = list[i];
    const col = c ? '#ffffff' : '#dfe8ee';
    R(x - 6, y + 4, 28, 6, col); R(x - 2, y, 20, 6, col); R(x + 4, y - 3, 10, 4, col); R(x - 6, y + 9, 28, 1, '#b9c6d0');
    if (!c) return;
    const busy = runs.some(r => r.engine === 'cloud' && r.url === c.url && r.status === 'running');
    // антенналы робот-агент
    const cx = x + 4, cy = y - 12, bob = Math.floor(t / 500 + i) % 2;
    R(cx + 3, cy - 4 + bob, 1, 3, '#3a3e48'); R(cx + 2, cy - 5 + bob, 3, 1, busy ? '#5fe07a' : '#e0b84f');
    R(cx, cy + bob, 8, 6, '#9aa6b8'); R(cx + 1, cy + 2 + bob, 2, 2, '#1a1a1a'); R(cx + 5, cy + 2 + bob, 2, 2, '#1a1a1a');
    R(cx, cy + 6 + bob, 8, 5, '#4f8fe0');
    const tag = fitText(c.project || 'cloud', 26 * S, 11);
    text(tag, x + 8, y + 20, 11, '#1d3a1d', 'center');
    if (selected === 'cloud:' + c.url) selBox(x - 7, y - 18, 30, 30);
    c._hit = { x: x - 7, y: y - 18, w: 30, h: 30 };
  });
}

function drawLights() {
  const n = nightAlpha(); if (n < 0.12) return;
  for (const [x, y] of LAMPS) { R(x * T + 3, y * T + 1, 2, 7, '#3a3e48'); R(x * T + 2, y * T, 4, 2, '#ffd76a'); }
  // жұмыс істеп жатқан мониторлар түнде жарқырайды
  for (const s of sprites.values()) if (s.desk !== undefined && atGoal(s) && !['wait', 'home', 'sleep'].includes(s.a.state)) {
    const d = offices[s.office].desks[s.desk]; ctx.globalAlpha = 0.35; R(d.x * T + 6, d.y * T - 6, 20, 15, '#7fd1ff'); ctx.globalAlpha = 1;
  }
}

function move(s, dt) {
  let px = 44 * dt;
  while (px > 0 && s.path.length) {
    const n = s.path[0], tx = n.x * T + 4, ty = n.y * T + 7, dx = tx - s.px, dy = ty - s.py, d = Math.hypot(dx, dy);
    if (Math.abs(dx) > Math.abs(dy)) s.dir = dx > 0 ? 'right' : 'left'; else s.dir = dy > 0 ? 'down' : 'up';
    if (d <= px) { s.px = tx; s.py = ty; s.path.shift(); px -= d; } else { s.px += dx / d * px; s.py += dy / d * px; px = 0; }
  }
  if (!s.path.length) s.dir = 'down';
}

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  for (const s of sprites.values()) move(s, dt);
  for (const s of helpers.values()) move(s, dt);
  ctx.setTransform(S, 0, 0, S, 0, 0); ctx.imageSmoothingEnabled = false;
  if (!staticLayer) drawStatic();
  ctx.drawImage(staticLayer, 0, 0);
  drawOffices(t);
  drawCloud(t);
  [...sprites.values(), ...helpers.values()].sort((a, b) => a.py - b.py).forEach(s => drawChar(s, t));
  const n = nightAlpha(); if (n > 0) { ctx.globalAlpha = n; R(0, 0, GW * T, GH * T, '#0a1030'); ctx.globalAlpha = 1; }
  drawLights();
  drawLabels();
  drawNames();
  drawBubbles();
  requestAnimationFrame(frame);
}

// ---------------- басу ----------------
cv.addEventListener('click', e => {
  const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * GW * T, y = (e.clientY - r.top) / r.height * GH * T;
  let best = null, bd = 1e9;
  for (const s of [...sprites.values(), ...helpers.values()]) {
    if (!s.hit) continue;
    const h = s.a.state === 'sleep' && !s.helper ? { x: beds[s.bed].x * T, y: beds[s.bed].y * T, w: 24, h: 16 } : s.hit;
    if (x >= h.x - 2 && x <= h.x + h.w + 2 && y >= h.y - 2 && y <= h.y + h.h + 2) { const d = Math.hypot(x - (h.x + h.w / 2), y - (h.y + h.h / 2)); if (d < bd) { bd = d; best = s; } }
  }
  for (const c of cloudList()) if (c._hit && x >= c._hit.x && x <= c._hit.x + c._hit.w && y >= c._hit.y && y <= c._hit.y + c._hit.h) return openCloud(c);
  if (best) openDrawer(best.helper ? best.a.parent : best.id);
});

// ---------------- панель ----------------
function fmtTime(ts) { if (!ts) return ''; const d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
function ago(ts) { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? s + ' с' : s < 3600 ? Math.round(s / 60) + ' мин' : Math.round(s / 3600) + ' сағ'; }

function renderList() {
  const st = snap.state, agents = (st && st.agents) || [];
  $('dot').className = 'sdot ' + (snap.online ? 'on' : 'off');
  const ob = $('offlineBanner');
  ob.hidden = !!snap.online;
  ob.textContent = snap.online ? '' : `Ноутбук өшірулі — қалада соңғы белгілі күй тұр. ${snap.cloudOnline && snap.vpsLogged ? 'Бұлт тапсырмаларын бере аласың: оларды VPS ашады.' : 'Бұлт worker-і де қолжетімсіз.'}`;
  $('statusText').textContent = (snap.online ? 'Ноутбук: қосулы' : snap.bridgeSeen ? `Ноутбук: өшірулі (${ago(snap.bridgeSeen)} бұрын)` : 'Ноутбук: әлі қосылмаған') + ' · ' + (snap.cloudOnline ? (snap.vpsLogged ? 'Бұлт: дайын' : 'Бұлт: VPS-те claude-қа кірілмеген') : 'Бұлт: жоқ');
  const working = agents.filter(a => !['wait', 'home', 'sleep'].includes(a.state)).length;
  const tokens = agents.reduce((n, a) => n + (a.tokens || 0), 0);
  const commits = agents.filter(a => a.commitTs && Date.now() - a.commitTs < 864e5).length;
  $('stats').innerHTML = `<span><b>${agents.length}</b> агент</span><span><b>${working}</b> жұмыста</span><span><b>${agents.filter(a => a.state === 'wait').length}</b> сізді күтуде</span><span><b>${tokens.toLocaleString()}</b> токен бүгін</span><span><b>${commits}</b> commit</span>`;
  const list = $('list');
  if (!agents.length) { list.innerHTML = '<div class="empty">Соңғы сағаттарда белсенді агент жоқ.</div>'; return; }
  const groups = new Map();
  for (const a of agents) { const k = a.project; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  let html = '';
  for (const [proj, arr] of groups) {
    html += `<div class="group">${esc(proj)}</div>`;
    for (const a of arr) {
      const s = sprites.get(a.id), col = s ? s.c.shirt : '#888', e = a.energy;
      html += `<div class="agent ${selected === a.id ? 'sel' : ''}" data-id="${esc(a.id)}">
        <div class="top"><span class="name"><span class="dot" style="background:${col}"></span>${esc(a.title || a.prompt || a.id.slice(0, 8))}</span><span class="state">${esc(KZ[a.state] || a.state)}</span></div>
        <div class="detail muted">${a.engine === 'codex' ? '<span class="tag">codex</span> ' : ''}${a.subagents && a.subagents.length ? `<span class="tag">+${a.subagents.length} көмекші</span> ` : ''}${esc(a.detail || '')}</div>
        <div class="bar"><i style="width:${Math.round(e * 100)}%;background:${energyColor(e)}"></i></div>
        <div class="muted">энергия ${Math.round(e * 100)}% · ${(a.tokens || 0).toLocaleString()} токен · ${ago(a.lastTs)} бұрын</div></div>`;
    }
  }
  list.innerHTML = html;
  list.querySelectorAll('.agent').forEach(el => el.onclick = () => openDrawer(el.dataset.id));
}

function renderRuns() {
  const runs = (snap.state && snap.state.runs) || [];
  $('runs').innerHTML = runs.length ? runs.map(r => `<div class="run"><div class="top"><span>${esc(r.engine === 'cloud' ? 'бұлт' : r.engine)} · ${esc((r.cwd || '').split('/').pop())}</span><span class="badge ${esc(r.status)}">${esc({ running: 'жүріп жатыр', done: 'бітті', failed: 'қате', stopped: 'тоқтатылды' }[r.status] || r.status)}</span></div>
    <div>${esc(r.text)}</div>${r.url ? `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">claude.ai/code сессиясы</a></div>` : ''}
    ${r.tail && r.tail.length ? `<pre>${esc(r.tail.slice(-4).join('\n'))}</pre>` : ''}
    ${r.status === 'running' && r.engine !== 'cloud' ? `<button class="danger" data-stop="${esc(r.id)}">Тоқтату</button>` : ''}</div>`).join('') : '';
  $('runs').querySelectorAll('[data-stop]').forEach(b => b.onclick = () => command({ type: 'stop', runId: b.dataset.stop }));
}

let drawerKind = null, drawerCloud = null;
function openDrawer(id) { selected = id; drawerKind = 'agent'; drawerCloud = null; $('drawer').hidden = false; renderDrawer(); renderList(); }
function openCloud(c) { selected = 'cloud:' + c.url; drawerKind = 'cloud'; drawerCloud = c; $('drawer').hidden = false; renderDrawer(); }
function closeDrawer() { selected = null; drawerKind = null; $('drawer').hidden = true; renderList(); }
$('dClose').onclick = closeDrawer;
$('dBody').addEventListener('click', e => { if (e.target.closest('[data-showmap]')) { const id = selected; $('drawer').hidden = true; setTab('town'); selected = id; setTimeout(() => centerMap(true), 50); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); $('modal').hidden = true; } });

function renderDrawer() {
  if ($('drawer').hidden) return;
  if (drawerKind === 'cloud') {
    const c = drawerCloud;
    $('dTitle').textContent = 'Бұлттық сессия'; $('dSub').textContent = `${c.project} · ${fmtTime(c.startedAt)}`;
    $('dBody').innerHTML = `<div><h3>Тапсырма</h3><div class="box">${esc(c.text)}</div></div>
      <div><a href="${esc(c.url)}" target="_blank" rel="noopener">claude.ai/code-та ашу</a></div>
      <p class="muted">Бұлттық сессияның жүрісі claude.ai/code-та ғана көрінеді. Мұнда оған жаңа хабар жіберуге болады.</p>`;
    $('stopBtn').hidden = true; $('handoffBtn').hidden = true; $('handoffHint').hidden = true; $('msgText').placeholder = 'Бұлттық сессияға хабар…';
    return;
  }
  const a = ((snap.state && snap.state.agents) || []).find(x => x.id === selected);
  if (!a) { $('dBody').innerHTML = '<div class="empty">Агент енді тізімде жоқ.</div>'; return; }
  $('dTitle').textContent = a.title || a.project;
  $('dSub').textContent = `${a.project} · ${a.engine} · ${KZ[a.state] || a.state} · ${a.id.slice(0, 8)}`;
  $('msgText').placeholder = 'Агентке хабар… (ноутбукта осы сессияны жалғастырады)';
  const e = a.energy;
  let h = `<button class="ghost m-only" data-showmap="1">Картадан көрсету</button><div><h3>Энергия</h3><div class="bar"><i style="width:${Math.round(e * 100)}%;background:${energyColor(e)}"></i></div><div class="muted">${Math.round(e * 100)}% · бүгін ${(a.tokens || 0).toLocaleString()} / ${(snap.state.budget || 0).toLocaleString()} output токен</div></div>`;
  if (a.prompt) h += `<div><h3>Соңғы тапсырмаң</h3><div class="box">${esc(a.prompt)}</div></div>`;
  if (a.detail) h += `<div><h3>Қазір</h3><div class="box">${esc(a.detail)}</div></div>`;
  if (a.todos && a.todos.length) {
    const done = a.todos.filter(t => t.s === 'completed').length;
    h += `<div><h3>Жоспар · ${done}/${a.todos.length}</h3><div class="bar"><i style="width:${Math.round(done / a.todos.length * 100)}%;background:#5fbf6a"></i></div><div class="box" style="margin-top:6px">${a.todos.map(t => `<div class="todo ${esc(t.s)}"><span class="s"></span><span class="t">${esc(t.t)}</span></div>`).join('')}</div></div>`;
  }
  if (a.subagents && a.subagents.length) h += `<div><h3>Көмекшілер (сабагент)</h3><div class="box">${a.subagents.map(s => `<div>${esc(s.title || s.id)} <span class="muted">— ${esc(s.detail || KZ[s.state] || '')}</span></div>`).join('')}</div></div>`;
  if (a.code && a.code.length) h += `<div><h3>Соңғы өзгеріс</h3><pre class="box code">${esc(a.code.join('\n'))}</pre></div>`;
  if (a.out && a.out.length) h += `<div><h3>Терминал</h3><pre class="box code term">${esc(a.out.join('\n'))}</pre></div>`;
  if (a.files && a.files.length) h += `<div><h3>Өзгерген файлдар</h3><div class="files">${a.files.map(f => `<span>${esc(f)}</span>`).join('')}</div></div>`;
  if (a.events && a.events.length) h += `<div><h3>Таймлайн</h3><div class="tl">${a.events.slice().reverse().map(ev => `<div><span class="tm">${fmtTime(ev.ts)}</span><span class="k" style="background:${EVC[ev.kind] || '#888'}"></span><span>${esc(ev.text)}</span></div>`).join('')}</div></div>`;
  const sc = $('dBody').scrollTop; $('dBody').innerHTML = h; $('dBody').scrollTop = sc;
  $('stopBtn').hidden = !a.runId; $('stopBtn').dataset.run = a.runId || '';
  const hasRemote = snap.state.remotes && Object.keys(snap.state.remotes).some(d => a.cwd === d || (a.cwd || '').startsWith(d + '/'));
  $('handoffBtn').hidden = !hasRemote;
  $('handoffHint').hidden = !hasRemote;
  $('handoffHint').textContent = !hasRemote ? '' : snap.online
    ? 'Бұлтта жалғастыру: аяқталмаған өзгерістер «agent-town/' + a.id.slice(0, 8) + '» бұтағына push болады (.env т.б. жіберілмейді), бұлттағы агент тапсырманы сол жерден жалғастырады. Жоғарыдағы өріске қосымша нұсқау жазуға болады.'
    : 'Ноутбук өшірулі: бұлт GitHub-тағы соңғы push-тан бастайды' + (a.handoff ? ' («' + a.handoff.branch + '» бұтағы)' : '') + '. Ноутбукта сақталмай қалған өзгерістер кірмейді.';
  if (a.handoff && a.handoff.url) $('handoffHint').innerHTML += ` <a href="${esc(a.handoff.url)}" target="_blank" rel="noopener">Алдыңғы жалғасы</a>`;
}

$('msgForm').onsubmit = e => {
  e.preventDefault();
  const text = $('msgText').value.trim(); if (!text) return;
  if (drawerKind === 'cloud') command({ type: 'message', cloudUrl: drawerCloud.url, text });
  else command({ type: 'message', agentId: selected, text });
  $('msgText').value = '';
};
$('stopBtn').onclick = () => command({ type: 'stop', runId: $('stopBtn').dataset.run });
$('handoffBtn').onclick = async () => {
  if (drawerKind !== 'agent') return;
  const ok = await command({ type: 'handoff', agentId: selected, text: $('msgText').value.trim() });
  if (ok) $('msgText').value = '';
};

// жаңа тапсырма
const HINTS = { claude: 'Ноутбукта сол папкада `claude -p` (bypassPermissions) іске қосылады. Қалада жаңа агент болып көрінеді.', codex: 'Ноутбукта `codex exec` іске қосылады.', cloud: 'Ноутбук `claude --cloud` арқылы claude.ai/code-та бұлттық сессия ашады. Ол репоның GitHub-тағы нұсқасымен жұмыс істейді, сондықтан алдымен push жаса.' };
function syncHint() { const v = document.querySelector('input[name=eng]:checked').value; $('engHint').textContent = !snap.online && v === 'cloud' ? 'Ноутбук офлайн: бұлттық сессияны VPS ашады. Репоның GitHub-тағы соңғы push-ы қолданылады.' : HINTS[v]; }
document.querySelectorAll('input[name=eng]').forEach(r => r.onchange = syncHint);
$('newBtn').onclick = () => {
  const projects = (snap.state && snap.state.projects) || [];
  $('nCwd').innerHTML = projects.map(p => `<option value="${esc(p)}">${esc(p.replace(/^\/home\/[^/]+/, '~'))}</option>`).join('');
  if (selected && drawerKind === 'agent') { const a = snap.state.agents.find(x => x.id === selected); if (a) $('nCwd').value = a.cwd; }
  // ноутбук офлайн болса — тек бұлт
  document.querySelectorAll('input[name=eng]').forEach(r => { r.disabled = !snap.online && r.value !== 'cloud'; if (r.disabled && r.checked) document.querySelector('input[name=eng][value=cloud]').checked = true; });
  if (!snap.online) $('nCwd').innerHTML = projects.filter(p => snap.state && snap.state.remotes && snap.state.remotes[p]).map(p => `<option value="${esc(p)}">${esc(p.replace(/^\/home\/[^/]+/, '~'))}</option>`).join('');
  syncHint(); $('modal').hidden = false; $('nText').focus();
};
$('nCancel').onclick = () => { $('modal').hidden = true; };
$('newForm').onsubmit = async e => {
  e.preventDefault();
  const ok = await command({ type: 'new', cwd: $('nCwd').value, engine: document.querySelector('input[name=eng]:checked').value, text: $('nText').value.trim() });
  if (ok) { $('modal').hidden = true; $('nText').value = ''; }
};

function toast(msg, bad) {
  const el = document.createElement('div'); el.className = 'toast' + (bad ? ' bad' : ''); el.textContent = msg;
  $('toasts').append(el); setTimeout(() => el.remove(), 5000);
}
async function command(c) {
  try {
    const r = await fetch('/api/command', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(c) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast(j.error || 'қате', true); return false; }
    toast(j.via === 'cloud' ? 'Жіберілді, VPS бұлт сессиясын ашуда…' : 'Жіберілді, ноутбук орындауда…'); return true;
  } catch { toast('Желі қатесі', true); return false; }
}

// ---------------- байланыс ----------------
let es = null;
function connect() {
  es = new EventSource('/api/stream');
  es.onmessage = ev => {
    snap = JSON.parse(ev.data);
    for (const r of snap.results || []) if (!lastResults.has(r.id + r.at)) { if (lastResults.size) toast(r.message, !r.ok); lastResults.add(r.id + r.at); }
    if (!lastResults.size) lastResults.add('init');
    syncAgents(); renderList(); renderRuns(); renderDrawer();
  };
  es.onerror = async () => {
    es.close();
    const r = await fetch('/api/me').catch(() => null);
    if (r && r.status === 401) return showLogin();
    $('statusText').textContent = 'серверге қайта қосылуда…'; setTimeout(connect, 3000);
  };
}
function showLogin() { $('app').hidden = true; $('login').hidden = false; $('pw').focus(); }
$('loginForm').onsubmit = async e => {
  e.preventDefault();
  const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
  if (r.ok) { $('login').hidden = true; start(); } else { const j = await r.json().catch(() => ({})); $('loginErr').textContent = j.error || 'қате'; }
};
$('logoutBtn').onclick = async () => { await fetch('/api/logout', { method: 'POST' }); location.reload(); };
function start() { $('app').hidden = false; connect(); requestAnimationFrame(frame); setInterval(() => { renderList(); }, 5000); }

// ---------------- мобильді: табтар, FAB, картаны агентке жылжыту ----------------
const mobile = () => matchMedia('(max-width: 900px)').matches;
function setTab(t) {
  document.body.dataset.tab = t;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t === 'town') requestAnimationFrame(centerMap);
}
document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('fab').onclick = () => $('newBtn').onclick();
document.body.dataset.tab = 'town';
if (!mobile()) $('legendBox').open = true;
let centered = false;
function centerMap(force) {
  if (!mobile()) return;
  const wrap = $('mapWrap'); if (!wrap.clientWidth) return;
  // ең белсенді агентке (немесе таңдалғанға) бұру
  const pick = (selected && sprites.get(selected)) || [...sprites.values()].find(s => !['home', 'sleep', 'wait'].includes(s.a.state)) || [...sprites.values()][0];
  if (!pick) return;
  const k = cv.clientWidth / (GW * T);
  wrap.scrollTo({ left: Math.max(0, pick.px * k - wrap.clientWidth / 2), top: Math.max(0, pick.py * k - wrap.clientHeight / 2), behavior: force ? 'smooth' : 'auto' });
  centered = true;
}
function updateCounts() {
  const st = snap.state || {}; $('tabAgents').textContent = (st.agents || []).length || '';
  const running = (st.runs || []).filter(r => r.status === 'running').length; $('tabRuns').textContent = running ? running + ' жүріп жатыр' : '';
}
setInterval(() => { updateCounts(); if (!centered) centerMap(); }, 1000);

fetch('/api/me').then(r => r.ok ? start() : showLogin()).catch(showLogin);
