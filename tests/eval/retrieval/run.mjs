#!/usr/bin/env node
// Free, offline graph-vs-ripgrep retrieval check (docs/value-review/README.md
// section 0.7 item 1). No LLM call, no network.
//
//   pnpm run build                       # monograph + CLI dist are needed once
//   node tests/eval/retrieval/run.mjs [--out FILE] [--keep] [--json]
//
//   --out FILE   write the full JSON report (format below) to FILE
//   --json       print the JSON report to stdout instead of the table
//   --keep       keep the staged sample + graph dir (path is printed)
//
// What it does: stages a PINNED sample (git archive of questions.json
// `sample.commit`, so later edits to the repo cannot move the answers), builds
// its monograph graph lexical-only (MONOGRAPH_EMBED=0), then answers
// questions.json with the REAL monograph MCP tool handlers from the built CLI
// (monograph_query / monograph_context / monograph_impact; answer cost is the
// size of their actual MCP text) and with a ripgrep baseline (files ranked by
// summed case-insensitive term hits). Runs in a throwaway HOME.
//
// Report JSON (schema "monomind.retrieval-eval/v1"):
//   { schema, generatedAt, sample:{commit,paths,files,nodes,edges}, k,
//     tokenEstimate:"chars/4",
//     systems: { "<name>": { overall:S, byKind:{<kind>:S} } },
//     questions: [ { id, kind, question, query, expect, acceptable?, k,
//       systems: { "<name>": { ranked:[files], rank, foundAt, precisionAtK,
//                              precisionReturned, recallAtK, rr, returned,
//                              tokens, calls, ms } } } ] }
//   S = { questions, foundRate, mrr, precisionAtK, precisionReturned,
//         recallAtK, tokensMean, tokensMedian, tokensTotal }
// Systems: graph:query (all questions), graph:context / graph:impact
// (callers/tests/callees questions), rg (all), rg:tests (tests questions, rg
// limited to *.test.ts). Everything except per-call `ms` is deterministic.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);

// A throwaway HOME so nothing touches the real one; embeddings off = lexical, deterministic.
const work = mkdtempSync(join(tmpdir(), 'mm-retrieval-'));
const home = join(work, 'home');
mkdirSync(home);
Object.assign(process.env, {
  HOME: home,
  XDG_DATA_HOME: join(home, 'data'),
  XDG_STATE_HOME: join(home, 'state'),
  XDG_CONFIG_HOME: join(home, 'config'),
  XDG_CACHE_HOME: join(home, 'cache'),
  MONOGRAPH_EMBED: '0',
});
const sampleDir = join(work, 'sample');
mkdirSync(sampleDir);

const lib = await import('./lib.mjs');
const spec = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'questions.json'), 'utf8'),
);

const monographDist = join(ROOT, 'packages/@monomind/monograph/dist/src/index.js');
const toolsDist = join(ROOT, 'packages/@monomind/cli/dist/src/mcp-tools/monograph/index.js');
for (const f of [monographDist, toolsDist])
  try {
    readFileSync(f);
  } catch {
    console.error(`${f} is missing; run \`pnpm run build\` first`);
    process.exit(2);
  }

// Stage the pinned sample and build its graph.
const tar = execFileSync('git', ['archive', spec.sample.commit, ...spec.sample.paths], {
  cwd: ROOT,
  maxBuffer: 1 << 28,
});
execFileSync('tar', ['-x', '-C', sampleDir], { input: tar });
process.env.MONOMIND_CWD = sampleDir;
const { buildAsync, openDb, closeDb } = await import(pathToFileURL(monographDist).href);
const build = await buildAsync(sampleDir, { force: true });
const db = openDb(join(sampleDir, '.monomind', 'monograph.db'));
const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const sample = {
  commit: spec.sample.commit,
  paths: spec.sample.paths,
  files: db.prepare("SELECT COUNT(*) n FROM nodes WHERE label='File'").get().n,
  nodes: count('nodes'),
  edges: count('edges'),
};
closeDb(db);
if (build.status !== 'built') throw new Error(`graph build: ${JSON.stringify(build)}`);

const { allMonographTools } = await import(pathToFileURL(toolsDist).href);
const tool = (n) => allMonographTools.find((t) => t.name === n);

const SECTIONS = {
  callers: ['Callers'],
  tests: ['Tested by', 'Tests of its file'],
  callees: ['Callees'],
  'impact-tests': ['Tests to run'],
};

async function call(name, args, state) {
  const t0 = Date.now();
  const r = await tool(name).handler(args);
  state.ms += Date.now() - t0;
  state.calls += 1;
  const texts = r.content.map((c) => c.text);
  state.tokens += texts.reduce((a, s) => a + lib.estimateTokens(s), 0);
  return texts[0];
}

/** One graph answer: the call(s) an agent would make, following the "re-run with filePath" hint once. */
async function graphAnswer(q, which) {
  const state = { tokens: 0, calls: 0, ms: 0 };
  if (which === 'query') {
    const text = await call('monograph_query', { query: q.query, limit: 10 }, state);
    return { ranked: lib.extractPaths(text), ...state };
  }
  const [family, what] = which.split('-'); // context-callers | impact-tests ...
  const name = `monograph_${family}`;
  let text = await call(name, { name: q.symbol }, state);
  const ambiguous = (s) => /matches \d+ definitions/.test(s);
  // Follow the tool's own hint: narrow by filePath, then by the first listed nodeId (non-test, non-process first).
  if (ambiguous(text)) text = await call(name, { name: q.symbol, filePath: q.filePath }, state);
  if (ambiguous(text))
    text = await call(name, { name: q.symbol, nodeId: text.match(/nodeId=(\S+)/)[1] }, state);
  const key = family === 'impact' && what === 'tests' ? 'impact-tests' : what;
  return { ranked: lib.sectionPaths(text, SECTIONS[key]), ...state };
}

function rgAnswer(q, testsOnly) {
  const t0 = Date.now();
  const term = q.symbol ?? q.query;
  const hits = lib.rgRanking(sampleDir, term, testsOnly ? { glob: '*.test.ts' } : {});
  const text = hits.map((h) => `${h.file}:${h.count}`).join('\n');
  return {
    ranked: hits.map((h) => h.file),
    tokens: lib.estimateTokens(text),
    calls: 1,
    ms: Date.now() - t0,
  };
}

const perSystem = {};
const questions = [];
for (const q of spec.questions) {
  const k = q.k ?? spec.k;
  const answers = {
    'graph:query': await graphAnswer(q, 'query'),
    rg: rgAnswer({ ...q, symbol: q.symbol }, false),
  };
  for (const which of q.tools ?? [])
    answers[`graph:${which.split('-')[0]}`] = await graphAnswer(q, which);
  if (q.kind === 'tests') answers['rg:tests'] = rgAnswer(q, true);
  const out = {
    id: q.id,
    kind: q.kind,
    question: q.question,
    query: q.query,
    expect: q.expect,
    k,
    systems: {},
  };
  if (q.acceptable) out.acceptable = q.acceptable;
  for (const [name, a] of Object.entries(answers)) {
    const score = lib.scoreRanking(a.ranked, q, k);
    out.systems[name] = {
      ranked: a.ranked.slice(0, Math.max(k, 10)),
      ...score,
      tokens: a.tokens,
      calls: a.calls,
      ms: a.ms,
    };
    (perSystem[name] ??= []).push({ kind: q.kind, score, tokens: a.tokens });
  }
  questions.push(out);
}

const report = {
  schema: 'monomind.retrieval-eval/v1',
  generatedAt: new Date().toISOString(),
  sample,
  k: spec.k,
  tokenEstimate: 'chars/4',
  systems: Object.fromEntries(Object.entries(perSystem).map(([n, rs]) => [n, lib.summarize(rs)])),
  questions,
};

if (opt('--out')) writeFileSync(opt('--out'), `${JSON.stringify(report, null, 2)}\n`);
if (flag('--json')) console.log(JSON.stringify(report, null, 2));
else printTable(report);

if (flag('--keep')) console.error(`kept ${work}`);
else rmSync(work, { recursive: true, force: true });
process.exit(0);

function printTable(r) {
  const f = (x, d = 2) => x.toFixed(d);
  console.log(
    `sample ${r.sample.commit}: ${r.sample.files} files, ${r.sample.nodes} nodes, ${r.sample.edges} edges; k=${r.k}; tokens = ${r.tokenEstimate}`,
  );
  const kinds = ['lookup', 'natural', 'callers', 'tests', 'callees', 'overall'];
  for (const kind of kinds) {
    const rows = Object.entries(r.systems)
      .map(([n, s]) => [n, kind === 'overall' ? s.overall : s.byKind[kind]])
      .filter(([, s]) => s);
    if (!rows.length) continue;
    console.log(`\n${kind}`);
    console.log('  system         n  found   MRR   P@k  Pret  R@k  tok/q(mean)  tok/q(med)');
    for (const [n, s] of rows)
      console.log(
        `  ${n.padEnd(13)} ${String(s.questions).padStart(2)}  ${f(s.foundRate)}  ${f(s.mrr)}  ${f(s.precisionAtK)}  ${f(s.precisionReturned)}  ${f(s.recallAtK)}  ${f(s.tokensMean, 0).padStart(10)}  ${f(s.tokensMedian, 0).padStart(10)}`,
      );
  }
  console.log('\nfound-at-rank (first relevant file; - = not in top k)');
  console.log(
    '  id   ' +
      Object.keys(r.systems)
        .map((n) => n.padEnd(13))
        .join(' '),
  );
  for (const q of r.questions)
    console.log(
      `  ${q.id}  ` +
        Object.keys(r.systems)
          .map((n) => String(q.systems[n]?.rank ?? (q.systems[n] ? '-' : '.')).padEnd(13))
          .join(' '),
    );
}
