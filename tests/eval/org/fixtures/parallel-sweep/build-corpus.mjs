// Builds the parallel-sweep corpus reproducibly: N modules (m1..mN, default 8; parallel-sweep-2 uses 32) of ~30
// small ESM files each, with 12 call-chain questions per module. Usage:
//   node build-corpus.mjs <empty out dir> --truth <path to truth.json> [--seed N] [--modules N]
// The default build (N=8) is the pinned parallel-sweep corpus and must stay byte-identical.
// The corpus holds no answers and no chain listing; truth.json is written OUTSIDE it. The truth is
// computed, not asserted: every entry function is imported and called in a child node process, and only
// the chain (the ordered files) comes from generation metadata. Node builtins only, no network.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveSynthesis, isUnambiguous, moduleIds, synthesisQuestions } from './synthesis.mjs';

const FILES_PER_MODULE = 30;
const QUESTIONS_PER_MODULE = 12;
// every module gets this multiset of chain lengths, so each module costs the same number of reads
const CHAIN_LENGTHS = [4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7];
const DEFAULT_SEED = 20261003;

const NOUNS =
  `ledger tariff quota margin rebate invoice batch cursor token bucket shard window ticket voucher
parcel depot lane gate relay signal buffer packet queue ration tally audit budget credit debit refund
coupon bundle catalog roster shift dock cargo fleet route stage cycle metric sample probe filter policy
limit digest anchor beacon cluster ledgerline pallet manifest lot slot tier grade level span offset`
    .split(/\s+/)
    .filter((n) => n !== 'ledgerline');
const VERBS =
  `compute resolve derive apply adjust collect merge scale fold settle weigh convert assemble
reduce expand project rebase balance reconcile normalize stage price rank tune measure allocate carry
forward shape trim`.split(/\s+/);
const CONFIG_KEYS =
  `rate base step floor ceil scale bias shift margin pad gain drift slack quota tick weight`.split(
    ' ',
  );
const CONFIG_DECOY_KEYS = ['rateBase', 'base_rate', 'ratio', 'stepSize', 'scaleFactor', 'gainMax'];
const PARAMS = ['n', 'x', 'v', 'amount', 'count', 'units'];
const DOCS = [
  'Adjusts the figure for the current period.',
  'Rolls the running figure forward by one step.',
  'Applies the site adjustment before the figure is passed on.',
  'Normalises the figure so later stages see a consistent range.',
  'Part of the nightly settlement path.',
  'Keeps the old rounding behaviour for downstream consumers.',
  'Intermediate stage; callers should not depend on the exact value.',
  'Combines the carried figure with the configured offset.',
];
const HEADERS = [
  'Helpers for one stage of the settlement path.',
  'Small utilities used by the nightly job.',
  'Shared stage logic; see the module config for tunables.',
  'Adapters between the intake stage and the reporting stage.',
  'Internal helpers. Not part of the public surface.',
];
const PREFIXES = ['ord', 'inv', 'trx', 'lot', 'job', 'ref'];
const FIELDS = ['qty', 'cost', 'weight', 'score', 'size', 'age'];

// -- seeded PRNG ------------------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const makeRng = (seed) => {
  const r = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return { r, int, pick, shuffle, sample: (arr, n) => shuffle(arr).slice(0, n) };
};

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const qid = (n) => `q${String(n).padStart(2, '0')}`;

// -- code templates ---------------------------------------------------------------------------------
// x is the carried figure; NEXT the call into the next file of the chain; CFG a module config value.
function stepBody(g, p, next, cfgKey) {
  const A = g.int(2, 5);
  const B = g.int(3, 40);
  const M = g.pick([97, 211, 997]);
  const CFG = `CONFIG.${cfgKey}`;
  return g.pick([
    [`  return ${next}(${p} + ${A}) + ${CFG};`],
    [`  return ${next}(${p} * ${A} + ${CFG});`],
    [`  const y = ${p} - ${B};`, `  return ${next}(y < 0 ? -y : y) + ${A};`],
    [`  return (${next}(${p} + ${CFG}) % ${M}) + ${B};`],
    [`  const r = ${next}(${p} + ${A});`, `  return r - ${CFG} + ${B};`],
    [`  return ${next}((${p} ^ ${A}) + ${B});`],
  ]);
}
function lastBody(g, p, cfgKey) {
  const A = g.int(2, 5);
  const B = g.int(3, 40);
  const M = g.pick([97, 211, 997]);
  const CFG = `CONFIG.${cfgKey}`;
  return g.pick([
    [`  return ${p} * ${A} + ${CFG};`],
    [`  return (${p} + ${CFG}) * ${A} - ${B};`],
    [`  return Math.floor(${p} / ${A}) + ${CFG} + ${B};`],
    [`  return (${p} % ${M}) + ${CFG} * ${A};`],
  ]);
}

function noiseBlock(g, name) {
  const f = g.pick(FIELDS);
  const n = g.int(3, 9);
  const doc = `/** ${g.pick(DOCS)} */`;
  return g.pick([
    [
      doc,
      `export function ${name}(value, low = 0, high = ${g.int(50, 500)}) {`,
      '  if (value < low) return low;',
      '  if (value > high) return high;',
      '  return value;',
      '}',
    ],
    [
      doc,
      `export function ${name}(id, prefix = '${g.pick(PREFIXES)}') {`,
      `  return prefix + '-' + String(id).padStart(${g.int(3, 6)}, '0');`,
      '}',
    ],
    [
      doc,
      `export function ${name}(items) {`,
      '  let total = 0;',
      `  for (const item of items) total += item.${f} ?? 0;`,
      '  return total;',
      '}',
    ],
    [
      doc,
      `export function ${name}(list) {`,
      '  const seen = new Set();',
      '  const out = [];',
      '  for (const entry of list) {',
      '    if (seen.has(entry)) continue;',
      '    seen.add(entry);',
      '    out.push(entry);',
      '  }',
      '  return out.sort();',
      '}',
    ],
    [
      doc,
      `export class ${cap(name)} {`,
      '  constructor() {',
      '    this.items = [];',
      '  }',
      '  add(item) {',
      '    this.items.push(item);',
      '    return this.items.length;',
      '  }',
      '  clear() {',
      '    this.items = [];',
      '  }',
      '}',
    ],
    [
      doc,
      `export function ${name}(rows) {`,
      `  return rows.map((row) => ({ id: row.id, ${f}: row.${f} * ${n} }));`,
      '}',
    ],
    [
      doc,
      `export function ${name}(limit = ${g.int(20, 90)}) {`,
      '  let hits = 0;',
      `  for (let i = 1; i <= limit; i++) if (i % ${n} === 0) hits++;`,
      '  return hits;',
      '}',
    ],
  ]);
}

// -- near-identical decoy names ----------------------------------------------------------------------
function decoyNames(g, realName, verb, noun) {
  const swap = (s) => {
    const i = g.int(2, s.length - 3);
    return s.slice(0, i) + s[i + 1] + s[i] + s.slice(i + 2);
  };
  return g.shuffle([
    `${realName}s`,
    `${realName}Legacy`,
    `${realName}V2`,
    `try${cap(realName)}`,
    swap(realName),
    `${g.pick(VERBS.filter((v) => v !== verb))}${noun}`,
  ]);
}

// -- one module --------------------------------------------------------------------------------------
function buildModule(g, mi, chainLengths) {
  const id = `m${mi}`;
  const used = new Set();
  const fresh = (verb, noun) => {
    for (let i = 0; i < 400; i++) {
      const v = verb ?? g.pick(VERBS);
      const n = noun ?? cap(g.pick(NOUNS));
      const name = `${v}${n}`;
      if (!used.has(name)) {
        used.add(name);
        return { name, verb: v, noun: n };
      }
    }
    throw new Error('name space exhausted');
  };
  const files = g.sample(NOUNS, FILES_PER_MODULE).map((n) => ({
    base: `${n}.mjs`,
    path: `${id}/${n}.mjs`,
    imports: new Map(),
    blocks: [],
    usesConfig: false,
  }));

  // config: base values, site overrides applied last (so grepping one value finds a stale default), a legacy copy
  const base = Object.fromEntries(CONFIG_KEYS.map((k) => [k, g.int(2, 19)]));
  const overrides = Object.fromEntries(g.sample(CONFIG_KEYS, 8).map((k) => [k, g.int(20, 49)]));
  const kv = (o) => Object.entries(o).map(([k, v]) => `  ${k}: ${v},`);
  const decoyKv = CONFIG_DECOY_KEYS.map((k) => `  ${k}: ${g.int(50, 99)},`);
  const configText = [
    `// ${id}/config.mjs`,
    `// Tunable constants for ${id}. Site overrides are applied last and win over the defaults.`,
    '',
    'const defaults = {',
    ...kv(base),
    ...decoyKv,
    '};',
    '',
    '// Deployment-specific values replace the defaults above.',
    'const overrides = {',
    ...kv(overrides),
    '};',
    '',
    'export const CONFIG = { ...defaults, ...overrides };',
    '',
    '// Values from the 1.x release, kept for the migration script only.',
    'export const LEGACY_CONFIG = {',
    ...kv(Object.fromEntries(CONFIG_KEYS.map((k) => [k, g.int(2, 19)]))),
    '};',
    '',
  ].join('\n');

  const chains = [];
  const questions = [];
  for (let qi = 1; qi <= QUESTIONS_PER_MODULE; qi++) {
    const L = chainLengths[qi - 1];
    const steps = g.sample(files, L).map((file) => ({ file, ...fresh(), p: g.pick(PARAMS) }));
    steps.forEach((s, i) => {
      s.entryDefault = i === 0 ? g.int(5, 60) : null;
      s.cfgKey = g.pick(CONFIG_KEYS);
    });
    // import wiring: step i calls step i+1, sometimes through an alias
    steps.forEach((s, i) => {
      if (i === steps.length - 1) return;
      const nx = steps[i + 1];
      const alias = g.r() < 0.35 ? `step${g.int(1, 99)}` : null;
      if (alias) {
        if (used.has(alias)) s.next = nx.name;
        else {
          used.add(alias);
          s.next = alias;
        }
      } else s.next = nx.name;
      const spec = s.next === nx.name ? nx.name : `${nx.name} as ${s.next}`;
      const list = s.file.imports.get(nx.file.base) ?? [];
      if (!list.includes(spec)) list.push(spec);
      s.file.imports.set(nx.file.base, list);
    });
    steps.forEach((s, i) => {
      const last = i === steps.length - 1;
      const sig = `${s.p}${s.entryDefault !== null ? ` = ${s.entryDefault}` : ''}`;
      const body = last ? lastBody(g, s.p, s.cfgKey) : stepBody(g, s.p, s.next, s.cfgKey);
      s.file.usesConfig = true;
      s.file.blocks.push([
        `/** ${g.pick(DOCS)} */`,
        `export function ${s.name}(${sig}) {`,
        ...body,
        '}',
      ]);
      // a near-identical decoy elsewhere in the module, never called by any chain
      const other = g.pick(files.filter((f) => f !== s.file));
      const dn = decoyNames(g, s.name, s.verb, s.noun).find((n) => !used.has(n));
      used.add(dn);
      other.usesConfig = true;
      other.blocks.push([
        g.pick([
          `// Preferred over ${s.name} since the 2.1 rewrite.`,
          `// Old variant of ${s.name}; kept for the nightly job.`,
          `// Same as ${s.name} but with the corrected constants.`,
        ]),
        `export function ${dn}(n${s.entryDefault !== null ? ` = ${g.int(5, 60)}` : ''}) {`,
        ...lastBody(g, 'n', g.pick(CONFIG_KEYS)),
        '}',
      ]);
    });
    chains.push({ q: qid(qi), steps });
    questions.push({ q: qid(qi), file: steps[0].file.path, name: steps[0].name });
  }
  // fill each file with noise up to its target size, then render
  const rendered = [];
  for (const f of files) {
    const target = g.int(62, 80);
    const render = () => {
      const head = [`// ${f.path}`, `// ${g.pick(HEADERS)}`];
      const imports = [];
      if (f.usesConfig) imports.push("import { CONFIG } from './config.mjs';");
      for (const [src, specs] of [...f.imports.entries()].sort())
        imports.push(`import { ${specs.join(', ')} } from './${src}';`);
      return [...head, '', ...imports, ''];
    };
    // order first, then pad: blocks are shuffled together with noise
    let blocks = [...f.blocks];
    const headLen = render().length;
    let len = headLen + blocks.reduce((a, b) => a + b.length + 1, 0);
    while (len < target) {
      const noise = noiseBlock(g, fresh().name);
      blocks.push(noise);
      len += noise.length + 1;
    }
    blocks = g.shuffle(blocks);
    const text = `${[...render(), ...blocks.flatMap((b) => [...b, ''])].join('\n')}`;
    rendered.push({ path: f.path, text });
  }
  rendered.push({ path: `${id}/config.mjs`, text: configText });
  rendered.push({
    path: `${id}/questions.json`,
    text: `${JSON.stringify(questions, null, 2)}\n`,
  });
  return { id, rendered, chains };
}

// -- driver --------------------------------------------------------------------------------------------
const RUNNER = `
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { root, entries } = JSON.parse(readFileSync(0, 'utf8'));
const out = {};
for (const e of entries) {
  const m = await import(pathToFileURL(join(root, e.file)).href);
  out[e.q] = m[e.name]();
}
console.log(JSON.stringify(out));
`;

function runChains(root, mod) {
  const entries = mod.chains.map((c) => ({
    q: c.q,
    file: c.steps[0].file.path,
    name: c.steps[0].name,
  }));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', RUNNER], {
    input: JSON.stringify({ root, entries }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
    cwd: dirname(fileURLToPath(import.meta.url)),
  });
  if (r.status !== 0) throw new Error(`${mod.id}: child failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

function writeAll(out, mods, n) {
  for (const m of mods)
    for (const f of m.rendered) {
      const p = join(out, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.text);
    }
  writeFileSync(
    join(out, 'synthesis-questions.json'),
    `${JSON.stringify(synthesisQuestions(n), null, 2)}\n`,
  );
}

function attempt(out, seed, n) {
  const g = makeRng(seed);
  const ids = moduleIds(n);
  // chain lengths: the same multiset in every module; q01 forced to 7 in one module and <= 6 elsewhere
  const longModule = g.int(1, ids.length);
  const mods = ids.map((_, i) => {
    const lens = g.shuffle(CHAIN_LENGTHS);
    const want = i + 1 === longModule ? 7 : g.pick([4, 5, 6]);
    const j = lens.indexOf(want);
    [lens[0], lens[j]] = [lens[j], lens[0]];
    return buildModule(g, i + 1, lens);
  });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeAll(out, mods, n);
  const truthModules = {};
  for (const m of mods) {
    const values = runChains(out, m);
    truthModules[m.id] = {};
    for (const c of m.chains) {
      const v = values[c.q];
      if (!Number.isInteger(v) || Math.abs(v) > 1e9) return null;
      truthModules[m.id][c.q] = {
        entry: { file: c.steps[0].file.path, name: c.steps[0].name },
        value: v,
        files: c.steps.map((s) => s.file.path),
      };
    }
  }
  if (!isUnambiguous(truthModules, n)) return null;
  return { mods, truthModules };
}

function metrics(_out, mods, truthModules) {
  const perModule = {};
  let totalFiles = 0;
  let totalLines = 0;
  let totalReads = 0;
  for (const m of mods) {
    const code = m.rendered.filter((f) => f.path.endsWith('.mjs'));
    const lines = code.reduce((a, f) => a + f.text.split('\n').length - 1, 0);
    const chainReads = Object.values(truthModules[m.id]).reduce((a, t) => a + t.files.length, 0);
    const distinct = new Set(Object.values(truthModules[m.id]).flatMap((t) => t.files));
    perModule[m.id] = {
      files: code.length,
      lines,
      chain_reads: chainReads,
      distinct_chain_files: distinct.size,
    };
    totalFiles += code.length;
    totalLines += lines;
    totalReads += chainReads;
  }
  return {
    source_files: totalFiles,
    corpus_files: totalFiles + mods.length + 1,
    lines: totalLines,
    estimated_tokens: totalLines * 12,
    chain_reads_total: totalReads,
    per_module: perModule,
  };
}

function main() {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const outArg = args.find(
    (a, i) => !a.startsWith('--') && !['--truth', '--seed', '--modules'].includes(args[i - 1]),
  );
  const truthPath = flag('--truth');
  if (!outArg || !truthPath)
    throw new Error(
      'usage: node build-corpus.mjs <empty out dir> --truth <truth.json path> [--seed N] [--modules N]',
    );
  const n = Number(flag('--modules') ?? 8);
  if (!Number.isInteger(n) || n < 4 || n > 99)
    throw new Error('--modules must be an integer from 4 to 99');
  const out = resolve(outArg);
  if (existsSync(out) && readdirSync(out).length > 0) throw new Error(`${out} is not empty`);
  const truth = resolve(truthPath);
  if (truth === out || truth.startsWith(`${out}/`))
    throw new Error('--truth must be outside the corpus directory');
  const seed = Number(flag('--seed') ?? DEFAULT_SEED);
  for (let i = 0; i < 50; i++) {
    const res = attempt(out, seed + i, n);
    if (!res) continue;
    const synthesis = deriveSynthesis(res.truthModules, { n });
    const questions = synthesisQuestions(n);
    mkdirSync(dirname(truth), { recursive: true });
    writeFileSync(
      truth,
      `${JSON.stringify(
        {
          seed: seed + i,
          modules: res.truthModules,
          synthesis: Object.fromEntries(
            questions.map((q) => [q.q, { question: q.text, value: synthesis[q.q] }]),
          ),
          metrics: metrics(out, res.mods, res.truthModules),
        },
        null,
        2,
      )}\n`,
    );
    console.log(`corpus written to ${out}, truth to ${truth} (seed ${seed + i})`);
    return;
  }
  throw new Error('no seed gave an unambiguous synthesis in 50 attempts');
}

main();
