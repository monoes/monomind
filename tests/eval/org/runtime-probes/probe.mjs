#!/usr/bin/env node
/**
 * Runtime containment probe (workstream A2, group 2: grok, copilot, hermes).
 *
 * For each installed CLI this runs one cheap one-line turn inside a throwaway
 * HOME under /var/tmp and records where the CLI really writes its native
 * transcripts, logs and state. The real $HOME is only read: its top level is
 * fingerprinted before and after, and the real native dirs are scanned for
 * files newer than the probe start (leak check). Staged credentials are
 * symlinks whose real targets are hashed before and after.
 *
 * Usage: node probe.mjs <runtime> [variant]      probe one runtime (all variants by default)
 *        node probe.mjs --summary                 rebuild summary.json from the findings files
 *
 * Findings are written next to this script as <runtime>.json. Runtimes whose
 * CLI is not installed here are hand-recorded in their own findings files
 * (read-only inspection of the runner source, marked probed:false).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REAL_HOME = homedir();
const PROMPT = 'reply with OK';
const TURN_TIMEOUT_MS = 150_000;
// Env vars the probe passes through from the parent for auth only (never files).
const PASS_ENV = ['OPENROUTER_API_KEY'];

const FREE_GROK_MODEL = 'poolside/laguna-s-2.1:free';
const FREE_HERMES_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

const which = (name) => {
  try {
    return realpathSync(execFileSync('which', [name], { encoding: 'utf8' }).trim());
  } catch {
    return null;
  }
};

/** Per-runtime probe definitions. `{T}` = temp root, `{HOME}`, `{CWD}` are substituted. */
const RUNTIMES = {
  grok: {
    bin: () => which('grok'),
    versionArgs: ['--version'],
    nativeRealDirs: ['.grok'],
    stage: [{ rel: '.grok/config.toml', from: '.grok/config.toml' }],
    args: ['-p', PROMPT, '--output-format', 'json', '-m', FREE_GROK_MODEL],
    variants: {
      'home-only': { env: {}, stage: [{ rel: '.grok/config.toml', from: '.grok/config.toml' }] },
      'grok-home': {
        env: { GROK_HOME: '{T}/grok-home' },
        stage: [{ rel: '../grok-home/config.toml', from: '.grok/config.toml' }],
      },
    },
    costFrom: /"(?:total_)?cost(?:_usd)?"\s*:\s*([0-9.]+)/i,
  },
  copilot: {
    bin: () => which('copilot'),
    versionArgs: ['--version'],
    nativeRealDirs: ['.copilot', '.cache/copilot', '.config/gh'],
    args: ['-p', PROMPT, '--model', 'auto', '--auto-tier', 'efficiency', '-s', '--no-auto-update'],
    variants: {
      'home-only': {
        env: {},
        pathTools: ['gh'],
        stage: [{ rel: '.config/gh/hosts.yml', from: '.config/gh/hosts.yml' }],
      },
      'copilot-home': {
        env: { COPILOT_HOME: '{T}/copilot-home' },
        pathTools: ['gh'],
        stage: [{ rel: '.config/gh/hosts.yml', from: '.config/gh/hosts.yml' }],
      },
    },
  },
  hermes: {
    bin: () => which('hermes'),
    versionArgs: ['--version'],
    nativeRealDirs: ['.hermes'],
    args: ['chat', `--query=${PROMPT}`, '-Q', '-m', FREE_HERMES_MODEL, '--provider', 'openrouter'],
    variants: {
      'home-only': { env: {}, stage: [] },
      'hermes-home': { env: { HERMES_HOME: '{T}/hermes-home' }, stage: [] },
    },
  },
};

const sha = (p) => {
  try {
    return createHash('sha256').update(readFileSync(p)).digest('hex');
  } catch {
    return null;
  }
};

const md5 = (s) => createHash('md5').update(s).digest('hex');

function homeFingerprint() {
  const names = execFileSync('ls', ['-A', REAL_HOME], { encoding: 'utf8' });
  const long = execFileSync('ls', ['-la', '--time-style=full-iso', REAL_HOME], {
    encoding: 'utf8',
  });
  return { names: md5(names.split('\n').sort().join('\n')), long: md5(long), longListing: long };
}

function diffListings(a, b) {
  const la = new Set(a.split('\n'));
  const lb = new Set(b.split('\n'));
  return {
    removedOrChanged: [...la].filter((l) => !lb.has(l)),
    addedOrChanged: [...lb].filter((l) => !la.has(l)),
  };
}

/** Snapshot every entry under root: path -> {kind, size, mtimeMs}. Symlinks are not followed. */
function snapshot(root, limit = 20000) {
  const out = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (out.size >= limit) return;
      const p = join(dir, name);
      const st = lstatSync(p);
      const kind = st.isSymbolicLink() ? 'symlink' : st.isDirectory() ? 'dir' : 'file';
      out.set(relative(root, p), { kind, size: st.size, mtimeMs: Math.round(st.mtimeMs) });
      if (kind === 'dir') walk(p);
    }
  };
  walk(root);
  return out;
}

function diff(before, after) {
  const created = [];
  const modified = [];
  for (const [p, v] of after) {
    const b = before.get(p);
    if (!b) created.push({ path: p, kind: v.kind, size: v.size });
    else if (v.kind === 'file' && (b.size !== v.size || b.mtimeMs !== v.mtimeMs)) {
      modified.push({ path: p, size: v.size });
    }
  }
  return { created, modified };
}

/** Files under the real native dirs modified after `sinceMs` (leak / shared-state check). */
function realDirsTouchedSince(dirs, sinceMs) {
  const hits = [];
  const walk = (dir) => {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.mtimeMs > sinceMs && hits.length < 50) hits.push(relative(REAL_HOME, p));
    }
  };
  for (const d of dirs) walk(join(REAL_HOME, d));
  return hits;
}

const subst = (v, ctx) =>
  typeof v === 'string'
    ? v.replaceAll('{T}', ctx.T).replaceAll('{HOME}', ctx.HOME).replaceAll('{CWD}', ctx.CWD)
    : v;

function redact(text, values) {
  let t = text;
  for (const v of values) if (v && v.length > 6) t = t.replaceAll(v, '<redacted>');
  return t;
}

/** Processes still alive whose environment points at this probe's temp HOME (daemon check). */
function survivors(T) {
  const out = [];
  for (const pid of readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    try {
      const env = readFileSync(`/proc/${pid}/environ`, 'utf8');
      if (env.includes(`HOME=${T}/home`)) {
        out.push({
          pid: Number(pid),
          cmd: readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').slice(0, 160),
        });
      }
    } catch {
      /* process gone or not ours */
    }
  }
  return out;
}

function runCapture(bin, args, opts) {
  return new Promise((resolveRun) => {
    const started = Date.now();
    let out = '';
    let err = '';
    const child = spawn(bin, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), TURN_TIMEOUT_MS);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({ code, signal, out, err, ms: Date.now() - started });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolveRun({ code: -1, signal: null, out, err: String(e), ms: Date.now() - started });
    });
  });
}

async function probeVariant(name, def, variantName) {
  const variant = def.variants[variantName];
  const bin = def.bin();
  if (!bin) throw new Error(`${name}: CLI not installed`);
  const T = mkdtempSync(join('/var/tmp', `probe-${name}-${variantName}-`));
  const HOME = join(T, 'home');
  const CWD = join(T, 'cwd');
  const ctx = { T, HOME, CWD };
  for (const d of [HOME, CWD, join(T, 'tmp')]) mkdirSync(d, { recursive: true });
  for (const d of [
    `${HOME}/.config`,
    `${HOME}/.local/share`,
    `${HOME}/.local/state`,
    `${HOME}/.cache`,
  ]) {
    mkdirSync(d, { recursive: true });
  }

  const staged = [];
  for (const s of variant.stage ?? []) {
    const link = join(HOME, s.rel);
    const target = join(REAL_HOME, s.from);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);
    staged.push({ link: relative(T, link), target: `~/${s.from}`, shaBefore: sha(target) });
  }

  const env = {
    PATH: [
      dirname(bin),
      ...(variant.pathTools ?? []).map((t) => dirname(which(t))),
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
    ].join(':'),
    HOME,
    XDG_CONFIG_HOME: `${HOME}/.config`,
    XDG_DATA_HOME: `${HOME}/.local/share`,
    XDG_STATE_HOME: `${HOME}/.local/state`,
    XDG_CACHE_HOME: `${HOME}/.cache`,
    XDG_RUNTIME_DIR: join(T, 'run'),
    TMPDIR: join(T, 'tmp'),
    LANG: 'C.UTF-8',
  };
  mkdirSync(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 });
  const passed = [];
  for (const k of PASS_ENV) {
    if (process.env[k]) {
      env[k] = process.env[k];
      passed.push(k);
    }
  }
  for (const [k, v] of Object.entries(variant.env)) {
    const val = subst(v, ctx);
    env[k] = val;
    if (val.startsWith(T)) mkdirSync(val, { recursive: true });
  }
  // Snapshot before ANY CLI invocation so --version side effects are counted too.
  const before = snapshot(T);
  const sinceMs = Date.now();
  const secrets = passed.map((k) => env[k]);
  const run = await runCapture(bin, def.args, { cwd: CWD, env });
  const after = snapshot(T);
  const changes = diff(before, after);
  const version = (await runCapture(bin, def.versionArgs, { cwd: CWD, env })).out
    .split('\n')[0]
    .trim();
  const costMatch = def.costFrom ? def.costFrom.exec(run.out) : null;

  const stagedAfter = staged.map((s) => ({
    ...s,
    shaAfter: sha(join(REAL_HOME, s.target.slice(2))),
    stillSymlink: lstatSync(join(T, s.link)).isSymbolicLink(),
  }));
  const classify = (p) => p.split('/')[0];
  const byTop = {};
  for (const f of changes.created) {
    if (f.kind === 'file') (byTop[classify(f.path)] ??= []).push(f.path);
  }
  return {
    variant: variantName,
    command: `${name} ${def.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
    cliVersion: version,
    envSet: {
      HOME: '<T>/home',
      XDG_CONFIG_HOME: '<T>/home/.config',
      XDG_DATA_HOME: '<T>/home/.local/share',
      XDG_STATE_HOME: '<T>/home/.local/state',
      XDG_CACHE_HOME: '<T>/home/.cache',
      XDG_RUNTIME_DIR: '<T>/run',
      TMPDIR: '<T>/tmp',
      ...Object.fromEntries(
        Object.entries(variant.env).map(([k, v]) => [k, v.replaceAll('{T}', '<T>')]),
      ),
      passedThrough: passed,
    },
    stagedAuthSymlinks: stagedAfter,
    exitCode: run.code,
    signal: run.signal,
    durationMs: run.ms,
    stdoutTail: redact(run.out.slice(-600), secrets),
    stderrTail: redact(run.err.slice(-600), secrets),
    worked: run.code === 0 && /OK/i.test(run.out),
    costUsdReported: costMatch ? Number(costMatch[1]) : null,
    filesCreatedFiles: changes.created.filter((f) => f.kind === 'file').map((f) => f.path),
    filesCreatedBytes: changes.created
      .filter((f) => f.kind === 'file')
      .reduce((n, f) => n + f.size, 0),
    filesCreatedByTopDir: Object.fromEntries(Object.entries(byTop).map(([k, v]) => [k, v.length])),
    filesModified: changes.modified.map((f) => f.path),
    createdUnderCwd: changes.created.filter((f) => f.path.startsWith('cwd/')).map((f) => f.path),
    processesLeftRunning: survivors(T),
    realNativeDirsTouched: realDirsTouchedSince(def.nativeRealDirs, sinceMs),
    tempRoot: T,
  };
}

async function main() {
  const [arg, only] = process.argv.slice(2);
  if (arg === '--summary') return summarize();
  const def = RUNTIMES[arg];
  if (!def) {
    console.error(`usage: probe.mjs <${Object.keys(RUNTIMES).join('|')}> [variant] | --summary`);
    process.exit(2);
  }
  const fpBefore = homeFingerprint();
  const results = [];
  for (const v of Object.keys(def.variants)) {
    if (only && only !== v) continue;
    results.push(await probeVariant(arg, def, v));
  }
  const fpAfter = homeFingerprint();
  // Directory-entry mtimes of ~/.monoagent (daemon heartbeat every 10s) and ~/.claude (the running
  // Claude Code session) churn independently of any probe, so they are excluded from the
  // long-listing comparison. The set of top-level names is still compared exactly.
  const stable = (l) =>
    l
      .split('\n')
      .filter((x) => !x.endsWith(' .monoagent') && !x.endsWith(' .claude'))
      .join('\n');
  const homeChanged =
    fpBefore.names !== fpAfter.names ||
    md5(stable(fpBefore.longListing)) !== md5(stable(fpAfter.longListing));
  const raw = {
    runtime: arg,
    probedAt: new Date().toISOString(),
    realHomeTopLevel: {
      namesMd5Before: fpBefore.names,
      namesMd5After: fpAfter.names,
      longMd5Before: fpBefore.long,
      longMd5After: fpAfter.long,
      changed: homeChanged,
      listingDiff: homeChanged ? diffListings(fpBefore.longListing, fpAfter.longListing) : null,
    },
    variants: results,
  };
  writeFileSync(join(HERE, `${arg}.raw.json`), `${JSON.stringify(raw, null, 2)}\n`);
  console.log(
    JSON.stringify({
      runtime: arg,
      homeChanged,
      variants: results.map((r) => ({
        v: r.variant,
        worked: r.worked,
        exit: r.exitCode,
        files: r.filesCreatedFiles.length,
      })),
    }),
  );
  if (homeChanged) {
    console.error('REAL HOME TOP LEVEL CHANGED - inspect listingDiff in the raw file');
    process.exit(3);
  }
}

function summarize() {
  const files = readdirSync(HERE).filter(
    (f) => f.endsWith('.json') && !f.endsWith('.raw.json') && f !== 'summary.json',
  );
  const rows = files.sort().map((f) => {
    const j = JSON.parse(readFileSync(join(HERE, f), 'utf8'));
    return {
      runtime: j.runtime,
      installed: j.installed,
      probed: j.probed,
      strategyRecommended: j.strategyRecommended,
      contained: j.contained?.value ?? j.contained,
      costUsd: j.costUsd,
    };
  });
  const totalCostUsd = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  writeFileSync(
    join(HERE, 'summary.json'),
    `${JSON.stringify({ generatedBy: 'probe.mjs --summary', totalCostUsd, runtimes: rows }, null, 2)}\n`,
  );
  console.log(`wrote summary.json (${rows.length} runtimes, $${totalCostUsd})`);
}

if (!existsSync(HERE)) mkdirSync(HERE, { recursive: true });
main();
