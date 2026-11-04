// Agent Town relay: VPS-те тұрады. Bridge (ноутбук) күйді осында жібереді,
// браузер күйді SSE арқылы алады және командаларды жібереді. Тәуелділіксіз.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3020;
const PASSWORD = process.env.TOWN_PASSWORD || '';
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || '';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC = path.join(__dirname, 'public');
if (!PASSWORD || !BRIDGE_TOKEN) { console.error('TOWN_PASSWORD және BRIDGE_TOKEN керек'); process.exit(1); }
fs.mkdirSync(DATA, { recursive: true });

const log = (...a) => console.log(new Date().toISOString(), ...a);
const audit = obj => fs.appendFile(path.join(DATA, 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...obj }) + '\n', () => {});
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- сессия (қолтаңбалы cookie) ----------
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('base64url'); }
function makeSession() { const exp = Date.now() + 30 * 864e5; const v = `${exp}.${crypto.randomBytes(8).toString('hex')}`; return `${v}.${sign(v)}`; }
function authed(req) {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)town=([^;]+)/);
  if (!m) return false;
  const parts = m[1].split('.'); if (parts.length !== 3) return false;
  const v = parts[0] + '.' + parts[1];
  return eq(sign(v), parts[2]) && +parts[0] > Date.now();
}
const loginHits = new Map(); // ip -> [ts]
function rateLimited(ip) {
  const now = Date.now(), arr = (loginHits.get(ip) || []).filter(t => now - t < 10 * 60e3);
  arr.push(now); loginHits.set(ip, arr);
  return arr.length > 8;
}

// ---------- күй ----------
let state = null, bridgeSeen = 0;
try { state = JSON.parse(fs.readFileSync(path.join(DATA, 'state.json'), 'utf8')); bridgeSeen = state.at || 0; } catch {}
let lastPersist = 0;
function persist() { if (Date.now() - lastPersist < 10e3) return; lastPersist = Date.now(); fs.writeFile(path.join(DATA, 'state.json'), JSON.stringify(state), () => {}); }
// екі орындаушы: ноутбук (laptop) және VPS-тегі бұлт worker-і (cloud)
const Q = { laptop: { queue: [], waiter: null, seen: 0 }, cloud: { queue: [], waiter: null, seen: 0 } };
let vpsCloud = [], vpsClaude = false, vpsLogged = false;
const results = [];        // соңғы нәтижелер
const clients = new Set(); // SSE
const online = () => Date.now() - bridgeSeen < 40e3;
const cloudOnline = () => Date.now() - Q.cloud.seen < 60e3 && vpsClaude;

function snapshot() { return JSON.stringify({ online: online(), bridgeSeen, cloudOnline: cloudOnline(), vpsLogged, vpsCloud, state, results: results.slice(-20) }); }
function broadcast() { const s = `data: ${snapshot()}\n\n`; for (const r of clients) r.write(s); }
setInterval(() => { for (const r of clients) r.write(': ping\n\n'); }, 20e3);
let wasOnline = '';
setInterval(() => { const o = online() + ':' + cloudOnline(); if (o !== wasOnline) { wasOnline = o; broadcast(); } }, 5e3);

function flush(q) {
  if (q.waiter && q.queue.length) { const w = q.waiter; q.waiter = null; clearTimeout(w.t); send(w.res, 200, { commands: q.queue.splice(0) }); }
}

// ---------- көмекшілер ----------
function send(res, code, obj, headers = {}) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(obj)); }
function body(req, limit = 4e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
const ipOf = req => (req.headers['x-real-ip'] || req.socket.remoteAddress || '').toString();
const bridgeOk = req => eq(req.headers.authorization || '', 'Bearer ' + BRIDGE_TOKEN);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

// «Бұлтта жалғастыру» үшін бұлттағы агентке берілетін тасымал жазбасы
function buildHandoff(a, note, branch, fromLaptop) {
  const L = [];
  L.push(`Сен ноутбуктағы Claude Code сессиясын бұлтта жалғастырып жатырсың (жоба: ${a.project}).`);
  L.push(fromLaptop
    ? `Репоның «${branch}» бұтағында ноутбуктағы соңғы күй тұр, оның ішінде commit жасалмаған өзгерістер де бар (соңғы commit — agent-town WIP). Құпия файлдар (.env т.б.) әдейі жіберілмеген.`
    : `Ноутбук өшірулі, сондықтан тек GitHub-тағы «${branch}» бұтағының соңғы push-ы бар. Ноутбукта push жасалмаған өзгерістер болуы мүмкін, оларды көре алмайсың.`);
  L.push('Алдымен `git log -3 --stat` пен `git status`-ты қарап, жағдайды түсін. Жұмыс біткенде сол бұтаққа commit + push жаса, негізгі бұтаққа тікелей жазба.');
  if (a.title) L.push(`\nСессия тақырыбы: ${a.title}`);
  if (a.prompt) L.push(`\nПайдаланушының соңғы тапсырмасы:\n${a.prompt}`);
  if (a.todos && a.todos.length) L.push('\nЖоспар (todo):\n' + a.todos.map(t => `- [${t.s === 'completed' ? 'x' : t.s === 'in_progress' ? '~' : ' '}] ${t.t}`).join('\n'));
  if (a.files && a.files.length) L.push('\nСоңғы өзгерген файлдар: ' + a.files.join(', '));
  const evs = (a.events || []).filter(e => e.kind !== 'think').slice(-20);
  if (evs.length) L.push('\nСоңғы әрекеттер (ескісінен жаңасына):\n' + evs.map(e => `- [${e.kind}] ${e.text}`).join('\n'));
  L.push(note ? `\nПайдаланушының қосымша нұсқауы:\n${note}` : '\nСоңғы тапсырманы аяғына дейін жеткіз.');
  return L.join('\n').slice(0, 7000);
}
function validCommand(c) {
  const t = String(c.type || '');
  const text = String(c.text || '').slice(0, 8000);
  if (t === 'message') {
    if (c.cloudUrl && /^https:\/\/claude\.ai\/code\/[\w-]+$/.test(String(c.cloudUrl))) return { type: t, cloudUrl: String(c.cloudUrl), text };
    return c.agentId ? { type: t, agentId: String(c.agentId).slice(0, 64), text } : null;
  }
  if (t === 'new') return c.cwd ? { type: t, cwd: String(c.cwd).slice(0, 500), text, engine: ['claude', 'codex', 'cloud'].includes(c.engine) ? c.engine : 'claude' } : null;
  if (t === 'stop') return c.runId ? { type: t, runId: String(c.runId).slice(0, 16) } : null;
  if (t === 'ping') return { type: t };
  if (t === 'handoff') return c.agentId ? { type: t, agentId: String(c.agentId).slice(0, 64), text: String(c.text || '').slice(0, 2000) } : null;
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    // ----- bridge -----
    if (p.startsWith('/bridge/')) {
      if (!bridgeOk(req)) return send(res, 401, { error: 'unauthorized' });
      const role = req.headers['x-role'] === 'cloud' ? 'cloud' : 'laptop', q = Q[role];
      q.seen = Date.now(); if (role === 'laptop') bridgeSeen = Date.now();
      if (p === '/bridge/state' && req.method === 'POST') { state = await body(req); persist(); broadcast(); return send(res, 200, { ok: true }); }
      if (p === '/bridge/cloudlist' && req.method === 'POST') { const b = await body(req, 2e5); vpsCloud = Array.isArray(b.sessions) ? b.sessions.slice(0, 12) : []; vpsClaude = !!b.claude; vpsLogged = !!b.loggedIn; broadcast(); return send(res, 200, { ok: true }); }
      if (p === '/bridge/poll' && req.method === 'GET') {
        if (q.queue.length) return send(res, 200, { commands: q.queue.splice(0) });
        if (q.waiter) { clearTimeout(q.waiter.t); send(q.waiter.res, 200, { commands: [] }); }
        const w = { res, t: setTimeout(() => { if (q.waiter === w) q.waiter = null; send(res, 200, { commands: [] }); }, 25e3) };
        q.waiter = w; req.on('close', () => { if (q.waiter === w) { clearTimeout(w.t); q.waiter = null; } });
        return;
      }
      if (p === '/bridge/result' && req.method === 'POST') {
        const r = await body(req, 1e5);
        results.push({ ...r, at: Date.now() }); if (results.length > 50) results.shift();
        audit({ kind: 'result', ...r }); broadcast();
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: 'not found' });
    }
    // ----- кіру -----
    if (p === '/api/login' && req.method === 'POST') {
      if (rateLimited(ipOf(req))) return send(res, 429, { error: 'тым көп әрекет, 10 минуттан соң' });
      const b = await body(req, 1e4);
      if (!eq(b.password || '', PASSWORD)) { audit({ kind: 'login-fail', ip: ipOf(req) }); return send(res, 401, { error: 'құпия сөз қате' }); }
      audit({ kind: 'login', ip: ipOf(req) });
      return send(res, 200, { ok: true }, { 'set-cookie': `town=${makeSession()}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 86400}` });
    }
    if (p === '/api/logout' && req.method === 'POST') return send(res, 200, { ok: true }, { 'set-cookie': 'town=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0' });
    if (p.startsWith('/api/')) {
      if (!authed(req)) return send(res, 401, { error: 'login' });
      if (p === '/api/me') return send(res, 200, { ok: true });
      if (p === '/api/stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.write(`data: ${snapshot()}\n\n`);
        clients.add(res); req.on('close', () => clients.delete(res));
        return;
      }
      if (p === '/api/command' && req.method === 'POST') {
        // CSRF: тек өз сайтымыздан
        const origin = req.headers.origin || '';
        if (origin && !origin.endsWith('://' + req.headers.host)) return send(res, 403, { error: 'origin' });
        const c = validCommand(await body(req, 2e4));
        if (!c) return send(res, 400, { error: 'команда дұрыс емес' });
        c.id = crypto.randomBytes(6).toString('hex');
        const isCloud = (c.type === 'new' && c.engine === 'cloud') || (c.type === 'message' && c.cloudUrl) || c.type === 'handoff';
        if (c.type === 'handoff') {
          const ag = state && (state.agents || []).find(x => x.id === c.agentId);
          if (!ag) return send(res, 404, { error: 'агент табылмады' });
          const remote = state.remotes && Object.entries(state.remotes).find(([dir]) => ag.cwd === dir || (ag.cwd || '').startsWith(dir + '/'));
          if (!remote) return send(res, 409, { error: 'бұл жобаның GitHub remote-ы жоқ' });
          const laptop = online();
          const branch = laptop ? `agent-town/${ag.id.slice(0, 8)}` : (ag.handoff && ag.handoff.branch) || ag.branch || 'main';
          c.branch = branch; c.remote = remote[1]; c.cwd = ag.cwd;
          c.text = buildHandoff(ag, c.text, branch, laptop);
          if (!laptop) c.type = 'new', c.engine = 'cloud';
        }
        let target = null;
        if (online()) target = 'laptop';
        else if (isCloud && cloudOnline()) {
          target = 'cloud';
          if (c.type === 'new') {
            c.remote = state && state.remotes ? state.remotes[c.cwd] : null;
            if (!c.remote) return send(res, 409, { error: 'бұл жобаның GitHub remote-ы белгісіз (ноутбук бір рет қосылуы керек)' });
          }
        }
        if (!target) return send(res, 409, { error: isCloud ? 'ноутбук та, VPS бұлт worker-і де офлайн' : 'ноутбук офлайн — тек бұлт тапсырмалары жүреді' });
        c.via = target;
        Q[target].queue.push(c); audit({ kind: 'command', ip: ipOf(req), ...c }); flush(Q[target]);
        return send(res, 200, { ok: true, id: c.id, via: target });
      }
      return send(res, 404, { error: 'not found' });
    }
    // ----- статика -----
    let f = p === '/' ? '/index.html' : p;
    const fp = path.join(PUBLIC, path.normalize(f).replace(/^(\.\.[/\\])+/, ''));
    if (!fp.startsWith(PUBLIC) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) {
    log('error', p, e.message);
    if (!res.headersSent) send(res, 400, { error: 'bad request' });
  }
}).listen(PORT, process.env.HOST || '127.0.0.1', () => log(`relay :${PORT}`));
