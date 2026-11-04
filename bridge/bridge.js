#!/usr/bin/env node
// Agent Town bridge: ноутбукта жұмыс істейді.
// 1) Claude Code + Codex транскрипттерін оқып, қала күйін relay-ге жібереді.
// 2) Relay-ден келген командаларды орындайды (хабар жіберу, жаңа тапсырма, тоқтату, бұлт).
// Тәуелділіксіз (Node 22+).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ---------- баптау ----------
const HOME = os.homedir();
loadEnv(path.join(__dirname, '.env'));
const RELAY = (process.env.RELAY_URL || 'http://127.0.0.1:3020').replace(/\/$/, '');
const TOKEN = process.env.BRIDGE_TOKEN || '';
const CLAUDE_ROOT = process.env.CLAUDE_PROJECTS || path.join(HOME, '.claude', 'projects');
const CODEX_ROOT = process.env.CODEX_SESSIONS || path.join(HOME, '.codex', 'sessions');
const DAILY_BUDGET = +process.env.DAILY_BUDGET || 120000;
const WINDOW_H = +process.env.WINDOW_H || 8;
const MAX_AGENTS = +process.env.MAX_AGENTS || 20;
const ALLOWED_ROOT = path.resolve(process.env.ALLOWED_ROOT || HOME);
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const CODEX_BIN = process.env.CODEX_BIN || 'codex';
const HOSTNAME = os.hostname();

function loadEnv(p) {
  try {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* .env міндетті емес */ }
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
// құпияларды жасыру: кілт=мән, Bearer, ұзын токендер
function redact(s) {
  return String(s ?? '')
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{8,}/g, '$1 •••')
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|KEY|PWD|AUTH)[A-Z0-9_]*)\s*[=:]\s*("[^"]*"|'[^']*'|\S+)/gi, '$1=•••')
    .replace(/\b(sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|\d{8,10}:[A-Za-z0-9_-]{30,}|[A-Za-z0-9_-]{40,})\b/g, '•••');
}
const clip = (s, n) => { s = redact(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const base = p => (p ? path.basename(String(p)) : '');

// ---------- инкрементті JSONL оқу ----------
function readLines(st, onLine) {
  let fd;
  try {
    const size = fs.statSync(st.path).size;
    if (size < st.offset) { st.reset(); }
    if (size === st.offset) return;
    fd = fs.openSync(st.path, 'r');
    // өте үлкен файлдың тек соңғы 8 МБ-ын бірінші рет оқимыз (токен есебі сонда да жеткілікті)
    if (st.offset === 0 && size > 8e6) { st.offset = size - 8e6; st.skipFirst = true; }
    const len = size - st.offset, buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.offset);
    st.offset = size;
    const lines = (st.rest + buf.toString('utf8')).split('\n');
    st.rest = lines.pop();
    if (st.skipFirst) { lines.shift(); st.skipFirst = false; }
    for (const l of lines) { if (l) { try { onLine(JSON.parse(l)); } catch { /* жарты жол */ } } }
  } catch { /* файл жоқ */ } finally { if (fd !== undefined) fs.closeSync(fd); }
}

// ---------- агент күйі ----------
function newAgent(p, engine) {
  const a = {
    path: p, engine, offset: 0, rest: '', day: todayStart(),
    sid: null, cwd: null, tokens: 0, lastTs: 0, turns: 0,
    last: null, pending: new Map(), tool: null, action: '', detail: '',
    prompt: '', events: [], files: [], todos: null, code: null, out: null,
    errTs: 0, commitTs: 0, pushTs: 0, test: null, title: '',
  };
  a.reset = () => Object.assign(a, newAgent(p, engine), { reset: a.reset });
  return a;
}
function ev(a, ts, kind, text) {
  a.events.push({ ts, kind, text: clip(text, 120) });
  if (a.events.length > 40) a.events.shift();
}
function touchFile(a, f) {
  if (!f) return; f = String(f);
  const rel = a.cwd && f.startsWith(a.cwd + '/') ? f.slice(a.cwd.length + 1) : base(f);
  a.files = [rel, ...a.files.filter(x => x !== rel)].slice(0, 15);
}
function snippet(text) {
  if (!text) return null;
  return redact(text).split('\n').slice(0, 14).map(l => l.replace(/\t/g, '  ').slice(0, 80));
}
const isTest = c => /\b(test|jest|vitest|pytest|go test|playwright|cargo test|npm run t)\b/.test(c);

// Claude құрал шақыруын «әрекет» түріне аудару
function classify(name) {
  if (/^(Edit|Write|NotebookEdit|MultiEdit)$/.test(name)) return 'type';
  if (/^(Read|Grep|Glob|LS)$/.test(name)) return 'read';
  if (name === 'Bash') return 'terminal';
  if (/Web|chrome|Fetch|browser/i.test(name)) return 'browse';
  if (/^(Agent|Task|SendMessage)$/.test(name)) return 'meeting';
  if (/^(TodoWrite|TaskCreate|TaskUpdate)$/.test(name)) return 'plan';
  return 'type';
}
function describeTool(a, name, input = {}) {
  switch (name) {
    case 'Edit': case 'MultiEdit': touchFile(a, input.file_path); a.code = snippet(input.new_string || (input.edits && input.edits[0] && input.edits[0].new_string)); return `Edit ${base(input.file_path)}`;
    case 'Write': touchFile(a, input.file_path); a.code = snippet(input.content); return `Write ${base(input.file_path)}`;
    case 'NotebookEdit': touchFile(a, input.notebook_path); return `Notebook ${base(input.notebook_path)}`;
    case 'Read': return `Read ${base(input.file_path)}`;
    case 'Grep': return `grep ${clip(input.pattern, 30)}`;
    case 'Glob': return `glob ${clip(input.pattern, 30)}`;
    case 'Bash': {
      const c = String(input.command || '');
      if (/\bgit\s+commit\b/.test(c)) a.commitTs = Date.now();
      if (/\bgit\s+push\b/.test(c)) a.pushTs = Date.now();
      return input.description ? clip(input.description, 60) : `$ ${clip(c, 60)}`;
    }
    case 'WebSearch': return `web: ${clip(input.query, 40)}`;
    case 'WebFetch': return `fetch ${clip(String(input.url || '').replace(/^https?:\/\//, ''), 40)}`;
    case 'Agent': case 'Task': return `агент: ${clip(input.description || input.prompt, 40)}`;
    case 'TodoWrite': a.todos = (input.todos || []).map(t => ({ t: clip(t.content || t.activeForm, 80), s: t.status })); return 'жоспар жаңартты';
    case 'TaskCreate': (a.todos ||= []).push({ t: clip(input.subject || input.description, 80), s: 'pending', id: input.id }); return 'тапсырма қосты';
    case 'TaskUpdate': { const t = (a.todos || []).find(x => x.id && x.id === input.taskId); if (t && input.status) t.s = input.status; return 'тапсырма жаңартты'; }
    default: return clip(name.replace(/^mcp__/, '').replace(/__/g, ' '), 40);
  }
}
const SYS_PROMPT = /^(<command-|<local-command|<system-reminder|Caveat:|\[Request interrupted|<task-notification|<bash-|This session is being continued)/;

function ingestClaude(a, d) {
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
  if (d.cwd) a.cwd = d.cwd;
  if (d.sessionId) a.sid = d.sessionId;
  if (d.gitBranch && d.gitBranch !== 'HEAD') a.branch = d.gitBranch;
  if (d.type === 'ai-title' || d.type === 'summary') a.title = clip(d.aiTitle || d.summary || d.title || a.title, 80);
  const m = d.message;
  if (!m) return;
  if (d.type === 'assistant') {
    if (ts >= a.day && m.usage) a.tokens += m.usage.output_tokens || 0;
    for (const c of m.content || []) {
      if (c.type === 'tool_use') {
        a.pending.set(c.id, c.name); a.tool = c.name; a.last = 'tool';
        a.action = classify(c.name);
        a.detail = describeTool(a, c.name, c.input || {});
        a.curCmd = c.name === 'Bash' ? String((c.input || {}).command || '') : '';
        ev(a, ts, a.action, a.detail);
      } else if (c.type === 'text' && c.text && c.text.trim()) {
        a.last = 'text'; ev(a, ts, 'say', c.text);
      } else if (c.type === 'thinking' && a.last !== 'tool') a.last = 'think';
    }
  } else if (d.type === 'user') {
    const content = m.content;
    const items = Array.isArray(content) ? content : [{ type: 'text', text: content }];
    let prompt = null, results = 0;
    for (const c of items) {
      if (c.type === 'tool_result') {
        results++;
        const name = a.pending.get(c.tool_use_id); a.pending.delete(c.tool_use_id);
        const txt = Array.isArray(c.content) ? c.content.map(x => x.text || '').join('\n') : String(c.content || '');
        if (name === 'Bash') {
          a.out = txt.split('\n').filter(Boolean).slice(-6).map(l => redact(l).slice(0, 80));
          if (isTest(a.curCmd || '')) { a.test = { ok: !c.is_error, ts }; ev(a, ts, c.is_error ? 'fail' : 'pass', c.is_error ? 'тест құлады' : 'тест өтті'); }
        }
        if (c.is_error) { a.errTs = ts || Date.now(); ev(a, ts, 'error', `${name || 'құрал'}: ${txt}`); }
      } else if (c.type === 'text' && c.text && !d.isMeta && !SYS_PROMPT.test(c.text.trim())) prompt = c.text;
    }
    if (prompt) { a.prompt = clip(prompt, 300); a.last = 'prompt'; a.turns++; ev(a, ts, 'prompt', prompt); }
    else if (results && a.pending.size === 0) a.last = 'think';
  }
  if (ts) a.lastTs = Math.max(a.lastTs, ts);
}

function ingestCodex(a, d) {
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
  const p = d.payload || {};
  if (d.type === 'session_meta') { a.sid = p.id || p.session_id; if (p.cwd) a.cwd = p.cwd; }
  if (d.type === 'turn_context' && p.cwd) a.cwd = p.cwd;
  if (d.type === 'event_msg') {
    if (p.type === 'token_count' && p.info && p.info.last_token_usage && ts >= a.day) a.tokens += p.info.last_token_usage.output_tokens || 0;
    if (p.type === 'task_started') { a.last = 'think'; }
    if (p.type === 'task_complete') { a.last = 'text'; a.pending.clear(); if (p.last_agent_message) ev(a, ts, 'say', p.last_agent_message); }
    if (p.type === 'item_completed' && p.item) {
      const it = p.item;
      if (it.type === 'UserMessage') {
        const t = (it.content || []).map(x => x.text || '').join(' ');
        if (t && !/^<(environment_context|user_instructions)/.test(t.trim())) { a.prompt = clip(t, 300); a.turns++; a.last = 'prompt'; ev(a, ts, 'prompt', t); }
      } else if (it.type === 'CommandExecution') {
        const c = Array.isArray(it.command) ? it.command[it.command.length - 1] : String(it.command || '');
        if (/\bgit\s+commit\b/.test(c)) a.commitTs = ts; if (/\bgit\s+push\b/.test(c)) a.pushTs = ts;
        const out = String(it.aggregated_output || it.output || '');
        if (out) a.out = out.split('\n').filter(Boolean).slice(-6).map(l => redact(l).slice(0, 80));
        const bad = typeof it.exit_code === 'number' && it.exit_code !== 0;
        if (isTest(c)) { a.test = { ok: !bad, ts }; ev(a, ts, bad ? 'fail' : 'pass', bad ? 'тест құлады' : 'тест өтті'); }
        else if (bad) { a.errTs = ts; ev(a, ts, 'error', `$ ${c}`); }
      } else if (it.type === 'FileChange') {
        const ch = it.changes || {};
        for (const f of Object.keys(ch)) touchFile(a, f);
        const first = Object.values(ch)[0];
        if (first) a.code = snippet(first.content || first.unified_diff || first.diff);
        a.tool = 'apply_patch'; a.action = 'type'; a.detail = `Edit ${base(Object.keys(ch)[0])}`; ev(a, ts, 'type', a.detail);
      } else if (it.type === 'AgentMessage') {
        const t = (it.content || []).map(x => x.text || '').join(' ');
        if (t) ev(a, ts, 'say', t);
      }
    }
  }
  if (d.type === 'response_item') {
    if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      const raw = String(p.input || p.arguments || '');
      const m = raw.match(/cmd\s*:\s*"((?:[^"\\]|\\.)*)"/) || raw.match(/"cmd"\s*:\s*"((?:[^"\\]|\\.)*)"/) || raw.match(/"command"\s*:\s*\[[^\]]*"((?:[^"\\]|\\.)*)"\s*\]/);
      const cmd = m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, ' ') : '';
      a.pending.set(p.call_id || p.id, p.name); a.last = 'tool'; a.tool = p.name;
      if (/apply_patch/.test(raw) || p.name === 'apply_patch') { a.action = 'type'; a.detail = 'apply_patch'; }
      else if (/^(cat|sed -n|rg|grep|ls|head|tail|find)\b/.test(cmd)) { a.action = 'read'; a.detail = `$ ${clip(cmd, 60)}`; }
      else if (cmd) { a.action = 'terminal'; a.detail = `$ ${clip(cmd, 60)}`; a.curCmd = cmd; }
      else { a.action = 'type'; a.detail = clip(p.name, 30); }
      ev(a, ts, a.action, a.detail);
    }
    if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') {
      a.pending.delete(p.call_id); if (!a.pending.size) a.last = 'think';
    }
  }
  if (ts) a.lastTs = Math.max(a.lastTs, ts);
}

// жоба атауы: git репо түбі > папка аты; ~/.claude ішіндегі сессиялар — «Claude баптаулары», ~ — «үй папкасы»
const nameCache = new Map();
function projectName(cwd) {
  if (!cwd) return '?';
  if (nameCache.has(cwd)) return nameCache.get(cwd);
  let n;
  if (cwd === HOME) n = 'үй папкасы (~)';
  else if (cwd.startsWith(path.join(HOME, '.claude'))) n = 'Claude баптаулары';
  else if (cwd.startsWith('/tmp/')) n = 'уақытша папка';
  else {
    try {
      const top = require('child_process').execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
      n = top && top !== HOME ? base(top) : null;
    } catch { n = null; }
    // git жоқ болса — ~/ астындағы бірінші деңгей папка (мыс. ~/agent-town/relay/public → agent-town)
    if (!n) n = cwd.startsWith(HOME + '/') ? path.relative(HOME, cwd).split(path.sep)[0] : base(cwd);
  }
  nameCache.set(cwd, n); return n;
}
function stateOf(a, now) {
  const idle = now - a.lastTs;
  const energy = Math.max(0, 1 - a.tokens / DAILY_BUDGET);
  if (energy <= 0 && idle > 60e3) return 'sleep';
  if (idle > 20 * 60e3) return 'home';
  if (a.last === 'tool' && a.pending.size) return idle > 10 * 60e3 ? 'wait' : (a.action === 'plan' ? 'think' : a.action || 'type');
  if (a.last === 'prompt' || a.last === 'think') return idle > 5 * 60e3 ? 'wait' : 'think';
  return 'wait';
}

// ---------- файлдарды табу ----------
const agents = new Map();   // path -> agent
const subs = new Map();     // path -> subagent

function listClaude(cutoff) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(CLAUDE_ROOT, { withFileTypes: true }); } catch { return out; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dp = path.join(CLAUDE_ROOT, dir.name);
    let files = []; try { files = fs.readdirSync(dp); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dp, f);
      try { const mt = fs.statSync(p).mtimeMs; if (mt > cutoff) out.push({ p, mt, engine: 'claude' }); } catch {}
    }
  }
  return out;
}
function listCodex(cutoff) {
  const out = [];
  const days = [0, 1].map(i => { const d = new Date(Date.now() - i * 864e5); return path.join(CODEX_ROOT, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')); });
  for (const dp of days) {
    let files = []; try { files = fs.readdirSync(dp); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const p = path.join(dp, f);
      try { const mt = fs.statSync(p).mtimeMs; if (mt > cutoff) out.push({ p, mt, engine: 'codex' }); } catch {}
    }
  }
  return out;
}
function subagentsOf(a, now) {
  const dir = path.join(path.dirname(a.path), path.basename(a.path, '.jsonl'), 'subagents');
  let files = []; try { files = fs.readdirSync(dir); } catch { return []; }
  const res = [];
  for (const f of files) {
    if (!f.endsWith('.jsonl')) continue;
    const p = path.join(dir, f);
    let mt = 0; try { mt = fs.statSync(p).mtimeMs; } catch { continue; }
    if (now - mt > 3 * 60e3) continue;
    let s = subs.get(p);
    if (!s) {
      s = newAgent(p, 'claude');
      try { const meta = JSON.parse(fs.readFileSync(p.replace(/\.jsonl$/, '.meta.json'), 'utf8')); s.title = clip(meta.description || meta.agentType || '', 60); } catch {}
      subs.set(p, s);
    }
    readLines(s, d => ingestClaude(s, { ...d, isSidechain: false }));
    if (!s.title && s.prompt) s.title = clip(s.prompt, 60);
    const st = stateOf(s, now);
    if (s.last === 'text' && now - s.lastTs > 20e3) continue; // бітті
    res.push({ id: path.basename(p, '.jsonl').slice(-8), title: s.title, state: st === 'wait' ? 'think' : st, detail: s.detail, tokens: s.tokens });
  }
  return res.slice(0, 4);
}

function scan() {
  const now = Date.now();
  const cutoff = now - WINDOW_H * 3600e3;
  const found = [...listClaude(cutoff), ...listCodex(cutoff)].sort((x, y) => y.mt - x.mt).slice(0, MAX_AGENTS * 2);
  const day = todayStart();
  const out = [];
  for (const f of found) {
    let a = agents.get(f.p);
    if (!a || a.day !== day) { a = newAgent(f.p, f.engine); agents.set(f.p, a); }
    readLines(a, d => (f.engine === 'claude' ? ingestClaude(a, d) : ingestCodex(a, d)));
    if (!a.lastTs || a.turns === 0 || a.lastTs < cutoff) continue;
    const run = [...runs.values()].find(r => r.sid && r.sid === a.sid && r.status === 'running');
    out.push({
      id: (a.sid || base(f.p)).slice(0, 36),
      engine: a.engine,
      cwd: a.cwd,
      project: projectName(a.cwd),
      title: a.title,
      state: stateOf(a, now),
      action: a.action, detail: a.detail, tool: a.tool,
      prompt: a.prompt,
      energy: Math.max(0, 1 - a.tokens / DAILY_BUDGET),
      tokens: a.tokens,
      lastTs: a.lastTs,
      events: a.events.slice(-30),
      files: a.files, todos: a.todos, code: a.code, out: a.out,
      errTs: a.errTs, commitTs: a.commitTs, pushTs: a.pushTs, test: a.test,
      subagents: a.engine === 'claude' ? subagentsOf(a, now) : [],
      runId: run ? run.id : null,
      branch: a.branch || null,
      handoff: handoffs[a.sid] || null,
    });
    if (out.length >= MAX_AGENTS) break;
  }
  for (const [p, a] of agents) if (a.lastTs && a.lastTs < cutoff - 3600e3) agents.delete(p);
  return out;
}

// ---------- командалар ----------
const runs = new Map(); // id -> run
function inAllowed(dir) {
  try { const r = fs.realpathSync(dir); return (r === ALLOWED_ROOT || r.startsWith(ALLOWED_ROOT + path.sep)) && fs.statSync(r).isDirectory() ? r : null; } catch { return null; }
}
function startRun({ engine, cwd, text, resume, cmdId, spawnCwd }) {
  const id = crypto.randomBytes(4).toString('hex');
  let bin, args;
  if (engine === 'codex') {
    bin = CODEX_BIN;
    args = resume ? ['exec', '--dangerously-bypass-approvals-and-sandbox', 'resume', resume, text] : ['exec', '--dangerously-bypass-approvals-and-sandbox', text];
  } else if (engine === 'cloud') {
    bin = CLAUDE_BIN;
    // resume = бұлттық сессия URL/id → хабар жіберу (құжатталған headless жол)
    if (resume) args = ['-p', text, '--cloud', resume, '--output-format', 'json'];
    else { bin = process.env.PYTHON || 'python3'; args = [path.join(__dirname, 'cloud_launch.py'), text]; } // --cloud TTY талап етеді
  } else {
    bin = CLAUDE_BIN;
    args = ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'stream-json', '--verbose'];
    if (resume) args.push('--resume', resume);
    args.push(text);
  }
  const run = { id, cmdId, engine, cwd, text: clip(text, 200), resume: resume || null, startedAt: Date.now(), status: 'running', exitCode: null, sid: resume || null, tail: [], url: null };
  runs.set(id, run);
  let child;
  try {
    child = spawn(bin, args, { cwd: spawnCwd || cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, AGENT_TOWN_RUN: id } });
  } catch (e) { run.status = 'failed'; run.tail.push(String(e)); return run; }
  run.pid = child.pid;
  let buf = '';
  const onData = chunk => {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      if (!l.trim()) continue;
      let shown = l;
      try {
        const j = JSON.parse(l);
        if (j.session_id && !run.sid) run.sid = j.session_id;
        if (j.type === 'result') shown = 'нәтиже: ' + clip(j.result, 200);
        else if (j.type === 'assistant') { const t = (j.message.content || []).find(c => c.type === 'text'); if (!t) continue; shown = t.text; }
        else continue;
      } catch { /* мәтін жол */ }
      const u = shown.match(/https:\/\/claude\.ai\/code\/[A-Za-z0-9_-]+/); if (u) run.url = u[0];
      run.tail.push(clip(shown, 200)); if (run.tail.length > 12) run.tail.shift();
    }
  };
  child.stdout.on('data', onData); child.stderr.on('data', onData);
  child.on('error', e => { run.status = 'failed'; run.tail.push(String(e.message)); });
  child.on('exit', code => { if (engine === 'cloud') { saveCloud(run); for (const h of Object.values(handoffs)) if (h.runId === run.id && run.url) { h.url = run.url; try { fs.writeFileSync(HANDOFF_FILE, JSON.stringify(handoffs, null, 1)); } catch {} } } run.status = run.status === 'stopped' ? 'stopped' : (code === 0 || (engine === 'cloud' && run.url)) ? 'done' : 'failed'; run.exitCode = code; run.endedAt = Date.now(); log('run', id, run.status, code); });
  log('run', id, engine, cwd, resume ? 'resume ' + resume.slice(0, 8) : '', clip(text, 60));
  return run;
}
// бұлттық сессиялар тізімі (қала оларды «Бұлт» алаңында көрсетеді)
const CLOUD_FILE = path.join(__dirname, 'cloud-sessions.json');
let cloud = []; try { cloud = JSON.parse(fs.readFileSync(CLOUD_FILE, 'utf8')); } catch {}
function saveCloud(run) {
  if (!run.url) return;
  const existing = cloud.find(c => c.url === run.url);
  if (existing) { existing.lastAt = Date.now(); existing.last = run.text; }
  else cloud.unshift({ id: run.id, url: run.url, cwd: run.cwd, project: base(run.cwd), text: run.text, startedAt: run.startedAt, lastAt: Date.now() });
  cloud = cloud.filter(c => Date.now() - c.lastAt < 3 * 864e5).slice(0, 12);
  try { fs.writeFileSync(CLOUD_FILE, JSON.stringify(cloud, null, 1)); } catch {}
}
// ---------- «Бұлтта жалғастыру» ----------
const HANDOFF_FILE = path.join(__dirname, 'handoffs.json');
let handoffs = {}; try { handoffs = JSON.parse(fs.readFileSync(HANDOFF_FILE, 'utf8')); } catch {}
const SECRET_FILE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_(rsa|ed25519|ecdsa)(\.pub)?|.*secret.*|.*credential.*|.*\.sqlite3?|.*\.db)$/i;
function git(dir, args, env) {
  return require('child_process').execFileSync('git', ['-C', dir, ...args], { timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } }).toString().trim();
}
// Аяқталмаған күйді ағымдағы бұтақ пен индекске тимей жеке бұтаққа push жасайды
function pushWip(dir, branch, note) {
  const top = git(dir, ['rev-parse', '--show-toplevel']);
  const tmpIndex = path.join(os.tmpdir(), `agent-town-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: tmpIndex };
  try {
    let head = null; try { head = git(top, ['rev-parse', 'HEAD']); } catch {}
    if (head) git(top, ['read-tree', 'HEAD'], env);
    git(top, ['add', '-A'], env);
    // құпия және үлкен файлдарды шығарып тастаймыз
    const staged = git(top, ['diff', '--cached', '--name-only', ...(head ? ['HEAD'] : [])], env).split('\n').filter(Boolean);
    const dropped = [];
    for (const f of staged) {
      let big = false; try { big = fs.statSync(path.join(top, f)).size > 5e6; } catch {}
      if (SECRET_FILE.test(f) || big) { try { git(top, ['rm', '--cached', '-q', '--ignore-unmatch', '--', f], env); } catch {} dropped.push(f); }
    }
    const tree = git(top, ['write-tree'], env);
    const changed = head ? git(top, ['diff', '--name-only', head, tree]).split('\n').filter(Boolean).length : staged.length;
    const msg = `agent-town: ноутбуктағы аяқталмаған күй (${note})`;
    const commit = git(top, ['-c', 'user.name=agent-town', '-c', 'user.email=agent-town@localhost', 'commit-tree', tree, ...(head ? ['-p', head] : []), '-m', msg]);
    git(top, ['push', '-q', '--force', 'origin', `${commit}:refs/heads/${branch}`]);
    return { top, changed, dropped };
  } finally { try { fs.unlinkSync(tmpIndex); } catch {} }
}
// Бұлт үшін «бос» репо: тек origin + керекті бұтақ (бұлт репоны GitHub-тан өзі алады)
function stubRepo(remote, branch) {
  const m = String(remote).match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) throw new Error('GitHub remote емес');
  const d = path.join(HOME, '.cache', 'agent-town', 'stubs', `${m[1]}__${m[2]}`);
  if (!fs.existsSync(path.join(d, '.git'))) {
    fs.mkdirSync(d, { recursive: true });
    git(d, ['init', '-q', '-b', 'main']);
    git(d, ['remote', 'add', 'origin', `https://github.com/${m[1]}/${m[2]}.git`]);
    git(d, ['-c', 'user.name=agent-town', '-c', 'user.email=agent-town@localhost', 'commit', '-q', '--allow-empty', '-m', 'stub']);
  }
  git(d, ['checkout', '-q', '-B', branch]);
  return d;
}
function handoff(cmd) {
  const a = findAgent(String(cmd.agentId || ''));
  if (!a || !a.cwd) return { ok: false, message: 'агент табылмады' };
  const cwd = inAllowed(a.cwd); if (!cwd) return { ok: false, message: 'бұл папкаға рұқсат жоқ' };
  const remote = remoteOf(cwd);
  if (!remote) return { ok: false, message: 'бұл жобаның GitHub remote-ы жоқ — бұлт оны ала алмайды' };
  const branch = String(cmd.branch || `agent-town/${a.sid.slice(0, 8)}`);
  let info;
  try { info = pushWip(cwd, branch, a.title || a.sid.slice(0, 8)); }
  catch (e) { return { ok: false, message: 'push сәтсіз: ' + clip(String(e.stderr || e.message), 200) }; }
  const stub = stubRepo(remote, branch);
  const r = startRun({ engine: 'cloud', cwd, spawnCwd: stub, text: String(cmd.text || ''), cmdId: cmd.id });
  r.text = clip('Жалғасы: ' + (a.title || a.prompt || a.sid.slice(0, 8)), 200);
  handoffs[a.sid] = { branch, remote, at: Date.now(), runId: r.id };
  try { fs.writeFileSync(HANDOFF_FILE, JSON.stringify(handoffs, null, 1)); } catch {}
  const extra = info.dropped.length ? ` (${info.dropped.length} құпия/үлкен файл жіберілмеді)` : '';
  return { ok: true, message: `«${branch}» бұтағына push болды (${info.changed} файл)${extra}, бұлттық сессия ашылуда`, runId: r.id };
}
function findAgent(id) { return [...agents.values()].find(a => a.sid && a.sid.startsWith(id)); }

function handle(cmd) {
  const text = String(cmd.text || '').trim();
  switch (cmd.type) {
    case 'message': {
      if (cmd.cloudUrl) {
        const c = cloud.find(x => x.url === cmd.cloudUrl);
        if (!c || !text) return { ok: false, message: 'бұлттық сессия табылмады' };
        const r = startRun({ engine: 'cloud', cwd: inAllowed(c.cwd) || HOME, text, resume: c.url, cmdId: cmd.id });
        r.url = c.url;
        return { ok: true, message: 'бұлтқа жіберілді', runId: r.id };
      }
      const a = findAgent(String(cmd.agentId || ''));
      if (!a || !a.cwd) return { ok: false, message: 'агент табылмады' };
      if (!text) return { ok: false, message: 'хабар бос' };
      const cwd = inAllowed(a.cwd); if (!cwd) return { ok: false, message: 'бұл папкаға рұқсат жоқ' };
      const r = startRun({ engine: a.engine, cwd, text, resume: a.sid, cmdId: cmd.id });
      return { ok: r.status !== 'failed', message: `жіберілді (${a.engine})`, runId: r.id };
    }
    case 'new': {
      const cwd = inAllowed(String(cmd.cwd || '')); if (!cwd) return { ok: false, message: 'папка жоқ немесе рұқсат етілмеген' };
      if (!text) return { ok: false, message: 'тапсырма бос' };
      const engine = ['claude', 'codex', 'cloud'].includes(cmd.engine) ? cmd.engine : 'claude';
      const r = startRun({ engine, cwd, text, cmdId: cmd.id });
      return { ok: r.status !== 'failed', message: engine === 'cloud' ? 'бұлттық сессия ашылуда' : 'тапсырма басталды', runId: r.id };
    }
    case 'stop': {
      const r = runs.get(String(cmd.runId || ''));
      if (!r || r.status !== 'running') return { ok: false, message: 'жүріп тұрған тапсырма жоқ' };
      r.status = 'stopped';
      try { process.kill(-r.pid, 'SIGTERM'); } catch { try { process.kill(r.pid, 'SIGTERM'); } catch {} }
      return { ok: true, message: 'тоқтатылды' };
    }
    case 'ping': return { ok: true, message: 'pong ' + HOSTNAME };
    case 'handoff': return handoff(cmd);
    default: return { ok: false, message: 'белгісіз команда' };
  }
}

const remoteCache = new Map();
function remoteOf(dir) {
  if (remoteCache.has(dir)) return remoteCache.get(dir);
  let r = null;
  const git = args => require('child_process').execFileSync('git', ['-C', dir, ...args], { timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    // ата-папканың репосын (мыс. ~/ портфолио) иемденбеу үшін: тек өз репосы бар папка
    const top = git(['rev-parse', '--show-toplevel']);
    if (top === dir || (top !== HOME && dir.startsWith(top + '/'))) r = git(['config', '--get', 'remote.origin.url']) || null;
  } catch {}
  remoteCache.set(dir, r); return r;
}
function remotes(list) { const o = {}; for (const p of list) { const r = remoteOf(p); if (r && /github\.com/.test(r)) o[p] = r; } return o; }
function projects() {
  const set = new Map();
  for (const a of agents.values()) if (a.cwd && inAllowed(a.cwd)) set.set(a.cwd, Math.max(set.get(a.cwd) || 0, a.lastTs));
  try {
    for (const d of fs.readdirSync(HOME, { withFileTypes: true })) {
      if (!d.isDirectory() || d.name.startsWith('.')) continue;
      const p = path.join(HOME, d.name);
      if (fs.existsSync(path.join(p, '.git')) && !set.has(p)) set.set(p, 0);
    }
  } catch {}
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).slice(0, 60);
}

// ---------- relay-мен байланыс ----------
// fetch орнына https.request: DNS сәтсіз болса RELAY_IP-ге (роутер кэші т.б.) түседі
const RELAY_IP = process.env.RELAY_IP || '';
const dns = require('dns');
function lookup(host, opts, cb) {
  dns.lookup(host, opts, (err, addr, fam) => {
    if (err && RELAY_IP) { return opts && opts.all ? cb(null, [{ address: RELAY_IP, family: 4 }]) : cb(null, RELAY_IP, 4); }
    cb(err, addr, fam);
  });
}
function req(method, p, body, timeoutMs = 15000) {
  const u = new URL(RELAY + p);
  const mod = u.protocol === 'https:' ? require('https') : require('http');
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  return new Promise((resolve, reject) => {
    const r = mod.request(u, { method, lookup, timeout: timeoutMs, headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...(data ? { 'content-length': data.length } : {}) } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`${p} → ${res.statusCode}`));
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); } catch (e) { reject(e); }
      });
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
    if (data) r.write(data); r.end();
  });
}

let lastHash = '', lastSent = 0, failCount = 0;
async function pushLoop() {
  for (;;) {
    try {
      const agentsNow = scan();
      const runList = [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 15).map(({ pid, ...r }) => r);
      const projs = projects();
      const state = { host: HOSTNAME, budget: DAILY_BUDGET, agents: agentsNow, runs: runList, cloud, projects: projs, remotes: remotes(projs) };
      const json = JSON.stringify(state);
      const h = crypto.createHash('sha1').update(json).digest('hex');
      if (h !== lastHash || Date.now() - lastSent > 10e3) {
        await req('POST', '/bridge/state', { ...state, at: Date.now() });
        lastHash = h; lastSent = Date.now();
        if (failCount) log('relay қайта қосылды'); failCount = 0;
      }
    } catch (e) { if (failCount++ % 20 === 0) log('state қатесі:', e.message); }
    await new Promise(r => setTimeout(r, 1500));
  }
}
async function pollLoop() {
  for (;;) {
    try {
      const r = await req('GET', '/bridge/poll', null, 35000);
      for (const cmd of (r && r.commands) || []) {
        let res;
        try { res = handle(cmd); } catch (e) { res = { ok: false, message: String(e.message) }; }
        log('cmd', cmd.type, res.ok ? 'ok' : 'FAIL', res.message);
        await req('POST', '/bridge/result', { id: cmd.id, ...res }).catch(() => {});
      }
    } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
  }
}

if (process.argv.includes('--dump')) { console.log(JSON.stringify(scan(), null, 1).slice(0, 6000)); process.exit(0); }
if (!TOKEN) { console.error('BRIDGE_TOKEN жоқ (.env)'); process.exit(1); }
log(`bridge → ${RELAY}, рұқсат: ${ALLOWED_ROOT}`);
pushLoop(); pollLoop();
