#!/usr/bin/env node
// Phase 0 trial preparation (org sections spec, section 9, step 0).
//
//   prepare.mjs snapshot --source <profile root> --org <name> --tools <dir> --repo <git checkout> --base <dir>
//     Takes the immutable inputs once: the org definition, its workspace, its
//     org memory, a read-only archive of the product repo at HEAD, the
//     captured mono-agent tool lists, and replay fixtures built from the
//     production runs' recorded automation results. No live calls.
//
//   prepare.mjs trial --base <dir> --arm control|treatment --trial <n> --caps <caps.json> [--model <id>]
//     Builds one isolated trial root from the snapshot: a renamed org with no
//     schedule, a fresh workspace and memory copy, every production path
//     redirected into the trial, recording stubs instead of mono-agent
//     grants, a write deny on the production profile, and the shared
//     per-role USD caps. Treatment differs from control only in
//     run_config.session_scope = "task". --model sets every Claude role's
//     model (roles on another provider, such as codex or antigravity, keep
//     theirs), so cheap trials can test the harness and the arms' difference
//     without production-model prices.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB = join(HERE, 'stub-monoagent-mcp.mjs');
const [cmd, ...rest] = process.argv.slice(2);
const { values: a } = parseArgs({
  args: rest,
  options: {
    source: { type: 'string' },
    org: { type: 'string' },
    tools: { type: 'string' },
    repo: { type: 'string' },
    base: { type: 'string' },
    arm: { type: 'string' },
    trial: { type: 'string' },
    caps: { type: 'string' },
    model: { type: 'string' },
  },
});
const need = (k) => {
  if (!a[k]) throw new Error(`--${k} is required for "${cmd}"`);
  return resolve(a[k]);
};
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`);

function makeReadOnly(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) makeReadOnly(p);
    else if (e.isFile()) chmodSync(p, statSync(p).mode & 0o555);
  }
  chmodSync(dir, statSync(dir).mode & 0o555);
}

/** Recorded automation outputs per tool, full text from the spill file when
 *  the bus copy was elided. Failed runs are not fixtures: a tool with none
 *  gets the stub's failure result, which is what production saw. */
function buildReplay(orgDir) {
  const replay = {};
  for (const run of readdirSync(orgDir).filter((d) => d.startsWith('run-')).sort()) {
    const bus = join(orgDir, run, 'bus.jsonl');
    if (!existsSync(bus)) continue;
    for (const line of readFileSync(bus, 'utf8').split('\n')) {
      if (!line.includes('"tool_result"') || !line.includes('monoagent__automation_')) continue;
      const e = JSON.parse(line);
      let out = e.data?.output ?? '';
      const spill = /full tool result at (\S+)/.exec(out)?.[1];
      if (spill) {
        const raw = readFileSync(spill, 'utf8');
        out = raw.slice(raw.indexOf('{')); // drop the "=== [0].text ===" framing
        out = out.slice(0, out.lastIndexOf('}') + 1);
      }
      let parsed;
      try {
        parsed = JSON.parse(out);
      } catch {
        continue;
      }
      if (parsed.status !== 'success' || typeof parsed.output !== 'string') continue;
      const tool = e.tool.slice(e.tool.indexOf('monoagent__') + 'monoagent__'.length);
      (replay[tool] ??= []).push(parsed.output);
    }
  }
  return replay;
}

function snapshot() {
  const source = need('source');
  const base = need('base');
  const org = a.org ?? 'monomind-growth';
  const snap = join(base, 'snapshot');
  if (existsSync(snap)) throw new Error(`${snap} exists; snapshots are immutable, use a new --base`);
  mkdirSync(snap, { recursive: true });
  const def = readJson(join(source, '.monomind/orgs', `${org}.json`));
  writeJson(join(snap, 'org.json'), def);
  cpSync(def.run_config.workspace, join(snap, 'workspace'), { recursive: true });
  cpSync(join(source, '.monomind/org-memory'), join(snap, 'org-memory'), { recursive: true });
  const repo = need('repo');
  const sha = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(join(snap, 'repo'));
  execFileSync('sh', ['-c', `git -C '${repo}' archive HEAD | tar -x -C '${join(snap, 'repo')}'`]);
  const tools = {};
  for (const f of readdirSync(need('tools')).filter((f) => /^tools-.+\.json$/.test(f)))
    tools[f.slice(6, -5)] = readJson(join(resolve(a.tools), f));
  writeJson(join(snap, 'tools.json'), tools);
  const replay = buildReplay(join(source, '.monomind/orgs', org));
  writeJson(join(snap, 'replay.json'), replay);
  writeJson(join(snap, 'manifest.json'), {
    takenAt: new Date().toISOString(),
    source,
    org,
    workspace: def.run_config.workspace,
    repo,
    repoSha: sha,
    replayCounts: Object.fromEntries(Object.entries(replay).map(([k, v]) => [k, v.length])),
  });
  makeReadOnly(snap);
  console.log(`snapshot at ${snap} (repo ${sha.slice(0, 9)}; replay ${JSON.stringify(Object.keys(replay))})`);
}

/** Replace every occurrence of `from` in every string of a JSON value. */
function rewrite(v, from, to) {
  if (typeof v === 'string') return v.split(from).join(to);
  if (Array.isArray(v)) return v.map((x) => rewrite(x, from, to));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rewrite(x, from, to)]));
  return v;
}

function trial() {
  const base = need('base');
  const snap = join(base, 'snapshot');
  const arm = a.arm;
  if (arm !== 'control' && arm !== 'treatment') throw new Error('--arm must be control or treatment');
  const n = a.trial ?? '1';
  const caps = readJson(need('caps'));
  const manifest = readJson(join(snap, 'manifest.json'));
  const name = `growth-p0-${arm}-${n}`;
  const model = a.model;
  const root = join(base, 'trials', name);
  if (existsSync(root)) throw new Error(`${root} exists; every trial starts from a fresh root`);
  const workspace = join(root, 'workspace');
  const stubDir = join(root, 'stubs');
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  mkdirSync(stubDir);
  cpSync(join(snap, 'workspace'), workspace, { recursive: true, mode: 0 });
  cpSync(join(snap, 'org-memory'), join(root, '.monomind/org-memory'), { recursive: true });
  for (const d of [workspace, join(root, '.monomind/org-memory')])
    execFileSync('chmod', ['-R', 'u+w', d]); // the snapshot is read-only; the trial copy is not

  let def = readJson(join(snap, 'org.json'));
  def = rewrite(def, manifest.workspace, workspace);
  def = rewrite(def, manifest.repo, join(snap, 'repo'));
  def.name = name;
  delete def.schedule;
  def.run_config.workspace = workspace;
  if (arm === 'treatment') def.run_config.session_scope = 'task';
  else delete def.run_config.session_scope;

  const tools = readJson(join(snap, 'tools.json'));
  const replay = readJson(join(snap, 'replay.json'));
  const calls = join(root, 'stub-calls.jsonl');
  writeFileSync(calls, '');
  for (const role of def.roles) {
    if (role.id in caps) role.budget_usd = caps[role.id];
    if (model && !role.provider) role.adapter_config = { ...(role.adapter_config ?? {}), model };
    // Bash can reach anything the sandbox leaves writable, home included; the
    // production profile is never a trial's to write.
    role.policy ??= {};
    role.policy.sandbox = {
      ...(role.policy.sandbox ?? {}),
      denyWrite: [...(role.policy.sandbox?.denyWrite ?? []), manifest.source],
    };
    for (const tp of role.tool_providers ?? []) {
      if (tp.name !== 'monoagent') throw new Error(`role ${role.id}: unexpected tool provider ${tp.name}`);
      const captured = tools[role.id];
      if (!captured) throw new Error(`role ${role.id}: no captured tool list`);
      const autos = role.automations ?? [];
      const outbound = autos.filter((x) => x.tier === 'irreversible' && x.wait === false).map((x) => `automation_${x.alias}`);
      const config = {
        initialize: captured.initialize,
        tools: captured.tools,
        outbound,
        async: autos.filter((x) => x.wait === false).map((x) => `automation_${x.alias}`),
        replay,
      };
      const cfgPath = join(stubDir, `${role.id}.json`);
      writeJson(cfgPath, config);
      tp.command = process.execPath;
      tp.args = [STUB, cfgPath, calls];
      delete tp.env;
    }
  }
  const leaked = JSON.stringify(def).includes(manifest.source) ? JSON.stringify(def).split(manifest.source).length - 1 : 0;
  // The only allowed mention of the production profile is the write deny itself.
  if (leaked !== def.roles.length) throw new Error(`production path still referenced ${leaked - def.roles.length} time(s) outside denyWrite`);
  writeJson(join(root, '.monomind/orgs', `${name}.json`), def);
  writeJson(join(root, 'trial.json'), { name, arm, trial: n, caps, model: model ?? null, snapshot: manifest, preparedAt: new Date().toISOString() });
  console.log(root);
}

if (cmd === 'snapshot') snapshot();
else if (cmd === 'trial') trial();
else {
  console.error('usage: prepare.mjs snapshot|trial [options]');
  process.exit(2);
}
