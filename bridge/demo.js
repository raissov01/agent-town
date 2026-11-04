#!/usr/bin/env node
// Демо: нақты агенттерсіз қаланы көру үшін relay-ге ойдан шығарылған күй жібереді.
//   RELAY_URL=http://127.0.0.1:3020 BRIDGE_TOKEN=... node demo.js
'use strict';
const RELAY = (process.env.RELAY_URL || 'http://127.0.0.1:3020').replace(/\/$/, '');
const TOKEN = process.env.BRIDGE_TOKEN || 'demo';
const now = () => Date.now();

const CODE = [
  "import { Router } from 'express';", '', 'export function ordersRouter(db) {', '  const r = Router();',
  "  r.get('/orders/:id', async (req, res) => {", '    const order = await db.orders.find(req.params.id);',
  "    if (!order) return res.status(404).json({ error: 'not found' });", '    res.json(order);', '  });',
  '  // TODO: pagination', '  return r;', '}',
];
const AGENTS = [
  { id: 'a1f0c2d4', engine: 'claude', project: 'shop-api', title: 'Orders API pagination', prompt: 'Add cursor pagination to /orders and cover it with tests', states: ['type', 'terminal', 'read', 'type'], details: ['Edit orders.ts', 'Run unit tests', 'Read db/orders.ts', 'Edit orders.test.ts'] },
  { id: 'b7e19a33', engine: 'claude', project: 'shop-api', title: 'Fix flaky e2e login', prompt: 'The login e2e test fails 1 in 5 runs, find out why', states: ['terminal', 'browse', 'think'], details: ['Run playwright e2e', 'web: playwright waitForURL flaky', '…'] },
  { id: 'c3d4e5f6', engine: 'codex', project: 'mobile-app', title: 'Dark mode for settings', prompt: 'Implement dark mode on the settings screen', states: ['type', 'read'], details: ['Edit SettingsScreen.kt', '$ rg "colorScheme"'] },
  { id: 'd9a8b7c6', engine: 'claude', project: 'landing', title: 'Pricing section copy', prompt: 'Rewrite the pricing section, three tiers', states: ['wait'], details: ['дайын — жауабыңды күтуде'] },
  { id: 'e1e2e3e4', engine: 'claude', project: 'infra', title: 'Nightly DB backup', prompt: 'Write a nightly pg_dump script with 7-day rotation', states: ['home'], details: [''] },
  { id: 'f5f6f7f8', engine: 'claude', project: 'mobile-app', title: 'Release notes 2.4', prompt: 'Draft release notes from the last 30 commits', states: ['sleep'], details: [''] },
];
const SUBS = [{ id: 'sub0001', title: 'Explore auth flow', state: 'read', detail: 'Read auth/session.ts' }, { id: 'sub0002', title: 'Check CI logs', state: 'terminal', detail: 'gh run view --log' }];

let tick = 0;
function state() {
  tick++;
  const agents = AGENTS.map((a, i) => {
    const k = Math.floor(tick / 6 + i) % a.states.length;
    const st = a.states[k];
    const energy = a.states[0] === 'sleep' ? 0 : Math.max(0.05, 0.95 - i * 0.14 - (tick % 400) / 2000);
    return {
      id: a.id + '-0000-4000-8000-000000000000', engine: a.engine, cwd: '/home/dev/' + a.project, project: a.project, title: a.title,
      state: st, action: st, detail: a.details[k], tool: 'Edit', prompt: a.prompt, energy, tokens: Math.round((1 - energy) * 120000),
      lastTs: now() - (st === 'home' ? 40 * 60e3 : 5e3),
      events: [{ ts: now() - 90e3, kind: 'prompt', text: a.prompt }, { ts: now() - 60e3, kind: 'read', text: 'Read README.md' }, { ts: now() - 30e3, kind: st, text: a.details[k] }],
      files: ['src/orders.ts', 'test/orders.test.ts'], todos: i === 0 ? [{ t: 'Add cursor param', s: 'completed' }, { t: 'Update handler', s: 'in_progress' }, { t: 'Write tests', s: 'pending' }] : null,
      code: CODE, out: ['PASS test/orders.test.ts', '  ✓ returns first page (12 ms)', '  ✓ follows cursor (9 ms)', 'Tests: 2 passed'],
      errTs: i === 1 && tick % 20 < 3 ? now() : 0, commitTs: i === 0 ? now() - 5 * 60e3 : 0, pushTs: 0, test: null,
      subagents: i === 1 ? SUBS : [], runId: null, branch: 'main', handoff: null,
    };
  });
  return {
    host: 'demo-laptop', budget: 120000, agents, runs: [], projects: agents.map(a => a.cwd),
    remotes: Object.fromEntries(agents.map(a => [a.cwd, `https://github.com/example/${a.project}.git`])),
    cloud: [{ id: 'c1', url: 'https://claude.ai/code/session_demo', cwd: '/home/dev/shop-api', project: 'shop-api', text: 'Refactor payments module', startedAt: now() - 600e3, lastAt: now() - 60e3 }],
    at: now(),
  };
}
async function push() {
  try {
    const r = await fetch(RELAY + '/bridge/state', { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(state()) });
    if (!r.ok) console.error('relay:', r.status);
  } catch (e) { console.error('relay:', e.message); }
}
console.log('demo →', RELAY);
setInterval(push, 1500); push();
