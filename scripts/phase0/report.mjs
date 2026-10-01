#!/usr/bin/env node
// Phase 0 trial report. Usage: report.mjs <trial root> [<trial root> ...]
// Per trial: outcome, wall time, per-role de-duplicated tokens and SDK USD
// (USD covers Claude roles only; codex/antigravity report none), session
// starts, concurrency deferrals, crashes, recorded stub calls, and the
// workspace files the trial created or changed against the snapshot.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const lines = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean) : []);

function files(dir) {
  const out = new Map();
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      // Top-level dot entries are the sandbox's runtime-held stub files, not output.
      if (d === dir && e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.set(relative(dir, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  walk(dir);
  return out;
}

/** Largest context any Claude session of the trial reached (input + cache
 *  read + cache write on one response), from its transcripts. A session at or
 *  near a model's window (200K on Haiku 4.5) is limited by the model, not by
 *  session scope, so the report flags it. */
function contextPeaks(name, limit) {
  const dir = join(homedir(), '.claude/projects', `-var-tmp-mm-phase0-trials-${name}-workspace`);
  if (!existsSync(dir)) return { maxContextTokens: null, sessionsNearLimit: [] };
  const peaks = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) {
        let peak = 0;
        for (const l of lines(p)) {
          let x;
          try {
            x = JSON.parse(l);
          } catch {
            continue;
          }
          const u = x.type === 'assistant' ? x.message?.usage : undefined;
          if (u) peak = Math.max(peak, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
        }
        peaks.push({ session: relative(dir, p), peak });
      }
    }
  };
  walk(dir);
  return {
    maxContextTokens: Math.max(0, ...peaks.map((x) => x.peak)),
    sessionsNearLimit: peaks.filter((x) => x.peak >= limit * 0.95),
  };
}

function report(root) {
  const trial = readJson(join(root, 'trial.json'));
  const orgDir = join(root, '.monomind/orgs', trial.name);
  const run = readdirSync(orgDir).filter((d) => d.startsWith('run-')).sort().at(-1);
  const roles = {};
  const r = (id) => (roles[id] ??= { usd: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, sessions: 0 });
  const counts = { deferrals: 0, crashes: 0, messages: 0, humanQuestions: 0 };
  const contextLimitCrashes = [];
  let first;
  let last;
  for (const l of lines(join(orgDir, run, 'bus.jsonl'))) {
    const e = JSON.parse(l);
    first ??= e.ts;
    last = e.ts;
    const d = e.data ?? {};
    if (e.type === 'usage') {
      const x = r(e.from);
      x.usd += d.cost_usd ?? 0;
      x.input += d.tokens_in ?? 0;
      x.output += d.tokens_out ?? 0;
      x.cacheRead += d.cache_read ?? 0;
      x.cacheCreation += d.cache_creation ?? 0;
    } else if (e.type === 'audit' && e.reason === 'session-run') r(e.from).sessions++;
    else if (e.reason === 'concurrency-limit') counts.deferrals++;
    else if (e.reason === 'agent-restart' || e.reason === 'agent-fatal') counts.crashes++;
    if (/contextLimit=true|prompt is too long|context.{0,20}(limit|window)/i.test(e.msg ?? '')) contextLimitCrashes.push(e.from);
    else if (e.type === 'message') counts.messages++;
    else if (e.type === 'question' && !d.requestId) counts.humanQuestions++;
  }
  const history = lines(join(orgDir, 'history.jsonl')).map((l) => JSON.parse(l)).find((h) => h.run === run);
  const calls = lines(join(root, 'stub-calls.jsonl')).map((l) => JSON.parse(l));
  const before = files(join(root, '..', '..', 'snapshot', 'workspace'));
  const after = files(join(root, 'workspace'));
  const changed = [...after].filter(([p, h]) => before.get(p) !== h).map(([p]) => (before.has(p) ? `M ${p}` : `A ${p}`));
  const deleted = [...before.keys()].filter((p) => !after.has(p)).map((p) => `D ${p}`);
  const total = Object.values(roles).reduce(
    (t, x) => ({
      usd: t.usd + x.usd,
      tokens: t.tokens + x.input + x.output + x.cacheRead + x.cacheCreation,
      cacheRead: t.cacheRead + x.cacheRead,
    }),
    { usd: 0, tokens: 0, cacheRead: 0 },
  );
  return {
    name: trial.name,
    arm: trial.arm,
    run,
    result: existsSync(join(root, 'result.json')) ? readJson(join(root, 'result.json')) : null,
    outcome: history?.outcome ?? null,
    closedBy: history?.closedBy ?? null,
    minutes: first && last ? Math.round((last - first) / 600) / 100 : null,
    totalUsdClaudeOnly: Math.round(total.usd * 100) / 100,
    totalTokens: total.tokens,
    cacheReadShare: total.tokens ? Math.round((1000 * total.cacheRead) / total.tokens) / 10 : null,
    ...counts,
    autoAnswered: lines(join(root, 'auto-answers.jsonl')).map((l) => JSON.parse(l)).filter((x) => x.kind !== 'gate').length,
    gates: (() => {
      const f = join(orgDir, 'gates.json');
      return existsSync(f) ? (readJson(f).gates ?? []).length : 0;
    })(),
    gatesAutoApproved: lines(join(root, 'auto-answers.jsonl')).map((l) => JSON.parse(l)).filter((x) => x.kind === 'gate').length,
    idleEnded: existsSync(join(root, 'idle-ended.json')),
    roles,
    stubCalls: {
      outbound: calls.filter((c) => c.outbound).map((c) => ({ role: c.role, tool: c.tool, input: c.input })),
      reads: calls.filter((c) => !c.outbound && c.tool !== 'automation_status' && c.tool !== 'automation_output').length,
    },
    workspaceChanges: [...changed, ...deleted].sort(),
    // Haiku 4.5 has a 200K window; production models have 1M.
    context: { ...contextPeaks(trial.name, trial.model?.includes('haiku') ? 200_000 : 1_000_000), contextLimitCrashes },
  };
}

console.log(JSON.stringify(process.argv.slice(2).map(report), null, 2));
