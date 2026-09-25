#!/usr/bin/env node
/**
 * Offline agent/skill picking eval (`pnpm run pick:eval`).
 *
 * Scores the tasks in tests/pick-eval/{dataset,holdout}.json — each lists
 * EVERY acceptable agent and skill id — as top-1 / top-3 hits, with the
 * keyword ranker run in-process over the built CLI (no network, no CLI spawn
 * per task). Needs `pnpm run build` first.
 *
 *   --catalog live|frozen   live project catalogs (default; ~/.claude/skills
 *                           left out) or tests/pick-eval/catalog-snapshot.json
 *   --set dataset|holdout|all   which tasks (default all)
 *   --jev                   rank through the real picker (rankForTask) with
 *                           this shell's decision-model env; keyword otherwise
 *   --json                  print the report as JSON
 *   --min-top1-agents N     exit 1 when agent top-1 hits < N
 *   --min-top1-skills N     exit 1 when skill top-1 hits < N
 *   --write-snapshot        write the live catalogs to catalog-snapshot.json
 *
 * Real use: `--logs [dir]` scores the hook logs instead (default this
 * checkout's .monomind; a copied .monomind or a project root works too).
 * Each Task/Agent spawn with its prompt on record is an example: redacted
 * prompt preview → the agent actually spawned. Reports the follow rate of
 * shown picks, how often the current ranker's top-1/top-3 holds the spawned
 * agent, and the top disagreements. With --catalog and --jev as above.
 *   --export FILE           also write the examples as a tests/pick-eval
 *                           dataset (local; review previews before committing)
 */
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'packages', '@monomind', 'cli', 'dist', 'src', 'decision');

function parseArgs(argv) {
  const opts = { catalog: 'live', set: 'all', jev: false, json: false, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--catalog') opts.catalog = value();
    else if (a === '--set') opts.set = value();
    else if (a === '--jev') opts.jev = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--write-snapshot') opts.write = true;
    else if (a === '--logs')
      opts.logs =
        argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : join(ROOT, '.monomind');
    else if (a === '--export') opts.export = value();
    else if (a === '--min-top1-agents') opts.minAgents = Number(value());
    else if (a === '--min-top1-skills') opts.minSkills = Number(value());
    else throw new Error(`unknown option ${a}`);
  }
  if (!['live', 'frozen'].includes(opts.catalog)) throw new Error('--catalog is live or frozen');
  if (!['dataset', 'holdout', 'all'].includes(opts.set))
    throw new Error('--set is dataset, holdout or all');
  for (const k of ['minAgents', 'minSkills'])
    if (opts[k] !== undefined && !Number.isFinite(opts[k]))
      throw new Error('thresholds are numbers');
  if (opts.export && !opts.logs) throw new Error('--export needs --logs');
  return opts;
}

async function load(file) {
  const path = join(DIST, file);
  if (!existsSync(path)) throw new Error(`${path} is missing; run \`pnpm run build\` first`);
  return import(pathToFileURL(path).href);
}

/** Pretty-printed the way biome formats it, so `pnpm run lint` stays clean. */
function snapshotBody(catalogs) {
  const _meta = {
    note: 'Frozen catalogs for tests/pick-eval/pick-eval.test.ts. Refresh only on purpose: `node scripts/pick-eval.mjs --write-snapshot`, then re-check the floors.',
    agents: catalogs.agents.length,
    skills: catalogs.skills.length,
  };
  return `${JSON.stringify({ _meta, agents: catalogs.agents, skills: catalogs.skills }, null, 2)}\n`;
}

async function jevPicks(tasks, catalogs) {
  const { rankForTask } = await load('picks.js');
  const methods = { agents: {}, skills: {} };
  const picks = [];
  for (const t of tasks) {
    const r = await rankForTask(t.task, catalogs, 3, {
      onError: (e) => process.stderr.write(`[pick-eval] ${e.provider}: ${e.message}\n`),
    });
    for (const k of ['agents', 'skills'])
      methods[k][r[k].method] = (methods[k][r[k].method] ?? 0) + 1;
    picks.push({
      agents: r.agents.ranked.map((e) => e.id),
      skills: r.skills.ranked.map((e) => e.id),
    });
  }
  return { picks, methods };
}

function printText(report, opts, methods, formatScore) {
  console.log(
    `pick eval — ${report.tasks} tasks, ${opts.catalog} catalog (${report.catalog.agents} agents, ${report.catalog.skills} skills), ${opts.jev ? 'jev' : 'keyword'}`,
  );
  if (methods)
    console.log(
      `  methods: agents ${JSON.stringify(methods.agents)}, skills ${JSON.stringify(methods.skills)}`,
    );
  for (const k of ['agents', 'skills']) {
    console.log(`  ${k.padEnd(6)} ${formatScore(report[k])}`);
    for (const m of report[k].misses)
      console.log(
        `    #${m.id} ${m.rank ? `hit@${m.rank}` : 'miss  '} got [${m.got.join(', ')}] want one of [${m.expected.join(', ')}]`,
      );
  }
  if (report.gated)
    for (const k of ['agents', 'skills']) {
      const g = report.gated[k];
      console.log(
        `  gated ${k}: shown ${g.shown}/${g.n}, correct ${g.correct} (precision ${g.precision ?? 'n/a'})`,
      );
      for (const w of g.wrong) console.log(`    #${w.id} showed ${w.shown}`);
    }
  if (report.unknown.length)
    console.log(
      `  expectations not in this catalog: ${report.unknown.map((u) => `#${u.id} ${u.kind}: ${u.missing.join(', ')}`).join('; ')}`,
    );
}

const pct = (num, den) => (den ? `${Math.round((100 * num) / den)}%` : 'n/a');
const tally = (list) => list.map((e) => `${e.name} ×${e.count}`).join(', ');

async function realUse(opts, catalogs) {
  const real = await load('pick-real.js');
  const logs = real.readRealUse(resolve(opts.logs));
  const r = logs.routes;
  const out = { logs: opts.logs, mode: opts.jev ? 'jev' : 'keyword', ...logs };
  if (logs.examples.length) {
    const picks = opts.jev
      ? (
          await jevPicks(
            logs.examples.map((e) => ({ task: e.preview })),
            catalogs,
          )
        ).picks.map((p) => p.agents)
      : real.keywordRealPicks(logs.examples, catalogs.agents);
    out.score = real.scoreRealUse(logs.examples, catalogs.agents, picks);
  }
  if (opts.export) {
    const tasks = real.realUseEvalTasks(logs.examples, catalogs.agents);
    writeFileSync(opts.export, `${JSON.stringify(tasks, null, 2)}\n`);
    out.exported = tasks.length;
  }
  if (opts.json) {
    console.log(JSON.stringify(out, null, 2));
    return 0;
  }

  const methods = Object.entries(r.methods)
    .map(([m, n]) => `${m} ${n}`)
    .join(', ');
  console.log(`pick eval (real use) — ${opts.logs}, ${opts.catalog} catalog, ${out.mode}`);
  console.log(
    `  routes: ${r.routes} routes, ${r.shown} shown (${pct(r.shown, r.routes)}), ${r.system} notifications; methods: ${methods || 'none'}`,
  );
  if (r.topRecommended.length) console.log(`  top recommended: ${tally(r.topRecommended)}`);
  if (!logs.spawns) {
    console.log(`  no spawns recorded yet${logs.hasAdherence ? '' : ' (no pick-adherence.jsonl)'}`);
  } else {
    const k = logs.skipped;
    console.log(
      `  spawns: ${logs.spawns} spawns, ${logs.examples.length} labelled prompts (skipped: ${k.system} notification, ${k.short} too short, ${k.noPrompt} no prompt on record)`,
    );
    console.log(
      `  followed the shown pick ${logs.shownFollowed}/${logs.shownSpawns} (${pct(logs.shownFollowed, logs.shownSpawns)}); any recorded pick ${logs.followed}/${logs.recommendedSpawns} (${pct(logs.followed, logs.recommendedSpawns)})`,
    );
  }
  const s = out.score;
  if (s) {
    console.log(
      `  current ranker holds the spawned agent: top-1 ${s.top1}/${s.n}, top-3 ${s.top3}/${s.n}${s.n ? ` (${pct(s.top3, s.n)} top-3)` : ''}`,
    );
    if (s.outOfCatalog.length)
      console.log(`  spawned agents outside the catalog (not scored): ${tally(s.outOfCatalog)}`);
    if (s.disagreements.length) console.log('  top disagreements (redacted previews):');
    for (const d of s.disagreements.slice(0, 10))
      console.log(
        `    ${d.spawns > 1 ? `×${d.spawns} ` : ''}"${d.preview}" spawned ${d.actual}, ranker [${d.got.join(', ')}]`,
      );
  }
  if (opts.export)
    console.log(
      `  wrote ${out.exported} examples to ${opts.export}; review the previews for private text before committing any of them to tests/pick-eval`,
    );
  return 0;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ev = await load('pick-eval.js');
  if (opts.logs) {
    const catalogs =
      opts.catalog === 'frozen' ? ev.readEvalSnapshot(ROOT) : ev.projectCatalogs(ROOT);
    if (!catalogs) throw new Error('tests/pick-eval/catalog-snapshot.json is missing or invalid');
    return realUse(opts, catalogs);
  }
  if (opts.write) {
    const catalogs = ev.projectCatalogs(ROOT);
    writeFileSync(join(ev.evalDir(ROOT), 'catalog-snapshot.json'), snapshotBody(catalogs));
    console.log(
      `wrote catalog-snapshot.json: ${catalogs.agents.length} agents, ${catalogs.skills.length} skills`,
    );
    return 0;
  }
  const tasks = ev.readEvalTasks(ROOT, opts.set === 'all' ? ['dataset', 'holdout'] : [opts.set]);
  if (!tasks) throw new Error(`no eval set under ${ev.evalDir(ROOT)}`);
  const catalogs = opts.catalog === 'frozen' ? ev.readEvalSnapshot(ROOT) : ev.projectCatalogs(ROOT);
  if (!catalogs) throw new Error('tests/pick-eval/catalog-snapshot.json is missing or invalid');

  let picks;
  let methods;
  if (opts.jev) ({ picks, methods } = await jevPicks(tasks, catalogs));
  else picks = ev.keywordPicks(tasks, catalogs);
  const score = ev.scorePicks(tasks, picks);
  const report = {
    ...score,
    mode: opts.jev ? 'jev' : 'keyword',
    catalog: {
      source: opts.catalog,
      agents: catalogs.agents.length,
      skills: catalogs.skills.length,
    },
    unknown: ev.unknownExpectations(tasks, catalogs),
    // The [PICK] gate over keyword ranking (what the hook shows without Jev).
    ...(opts.jev ? {} : { gated: ev.gatedEval(tasks, catalogs) }),
    ...(methods ? { methods } : {}),
  };

  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else printText(report, opts, methods, ev.formatScore);

  const failed = [];
  if (opts.minAgents !== undefined && score.agents.top1 < opts.minAgents)
    failed.push(`agent top-1 ${score.agents.top1} < ${opts.minAgents}`);
  if (opts.minSkills !== undefined && score.skills.top1 < opts.minSkills)
    failed.push(`skill top-1 ${score.skills.top1} < ${opts.minSkills}`);
  if (failed.length) {
    process.stderr.write(`pick eval below threshold: ${failed.join('; ')}\n`);
    return 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`pick-eval: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  },
);
