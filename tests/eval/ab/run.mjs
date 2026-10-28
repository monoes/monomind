#!/usr/bin/env node
// PAID A/B runner: the same fixed tasks under monomind-off / lean / full,
// measuring success, tokens, cost and wall time through `monomind agent exec`
// (doc/agent-exec-protocol.md section 3). It spends real money, so the default
// is a DRY RUN: it validates the tasks, prints the run plan and a cost
// estimate, spawns nothing and costs $0.
//
//   node tests/eval/ab/run.mjs                              # dry run, 3 reps x all arms x all tasks
//   node tests/eval/ab/run.mjs --reps 1 --arms off,full     # dry run of a smaller plan
//   node tests/eval/ab/run.mjs --execute --max-usd 40 --model <id> --out ab.json   # SPENDS MONEY
//
//   --tasks DIR        task files (default tests/eval/ab/tasks)
//   --arms a,b         subset of arms.json (default all)
//   --reps N           repetitions per task and arm (default 3)
//   --seed N           run-order seed (default 1)
//   --runtime ID       agent exec runtime (default claude)
//   --model ID         REQUIRED with --execute (pick the newest model of your family)
//   --price-in/-out    USD per million input/output tokens for the ESTIMATE (defaults 3 / 15:
//                      placeholders, set your model's real prices)
//   --max-usd N        REQUIRED with --execute. Hard cap: a run starts only if spent + its
//                      estimate fits, each turn also gets --budget-usd = min(remaining, run cap),
//                      and the loop stops at the first run that does not fit
//   --run-cap-usd N    per-turn --budget-usd cap (default 3 x the arm's estimated run cost)
//   --out FILE         write the JSON report (dry runs too); rewritten after every run
//   --keep             keep each throwaway workspace
//
// Task file (tests/eval/ab/tasks/*.json):
//   { id, title, tags[], fixture, prompt, maxTurns, timeoutS,
//     check: { command: [argv...], overlay, timeoutS } }
//   fixture = directory (relative to tests/eval/ab) copied into a fresh workspace per run;
//   after the turn `check.overlay` (hidden tests the agent never saw) is copied over it and
//   check.command runs there: exit 0 = success.
//
// Report (schema "monomind.ab-eval/v1"):
//   { schema, generatedAt, mode: "dry-run"|"execute", runtime, model, reps, seed, maxUsd,
//     price:{inPerMtok,outPerMtok}, estimate:{totalUsd, perArm:{<arm>:{runs,perRunUsd,usd}}},
//     spentUsd, stoppedForBudget,
//     runs:[{ task, arm, rep, status:"planned"|"done"|"skipped", success, checkExit,
//             tokens:{input,output}|null, costUsd|null, costKnown, wallMs, setupMs, exitCode,
//             stopReason, error, toolCalls:{total,byKind,monomind} }],
//     summary:{ <arm>:{runs,completed,skipped,success:{count,rate,lo,hi},tokensMean,
//              tokensMedian,costUsdMean,costUsdTotal,costUsdPerSuccess,wallMsMean,wallMsMedian} } }
//
// Agent turns run with --access full inside a throwaway workspace using your own
// runtime login; `--settings project` (never `user`) is what the lean/full arms
// load, so your personal config does not leak into the comparison.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  estimatePlan,
  parseExecOutput,
  planRuns,
  runCostUsd,
  SpendGuard,
  summarizeRuns,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const CLI = join(ROOT, 'packages/@monomind/cli/bin/cli.js');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const num = (n, d) => {
  const v = Number(opt(n, d));
  if (!Number.isFinite(v)) throw new Error(`${n} needs a number`);
  return v;
};

const execute = flag('--execute');
const reps = num('--reps', 3);
const seed = num('--seed', 1);
const runtime = opt('--runtime', 'claude');
const model = opt('--model');
const price = { inPerMtok: num('--price-in', 3), outPerMtok: num('--price-out', 15) };
const outFile = opt('--out');
const tasksDir = resolve(opt('--tasks', join(HERE, 'tasks')));

function loadTasks() {
  const tasks = readdirSync(tasksDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(tasksDir, f), 'utf8')));
  for (const t of tasks) {
    for (const k of ['id', 'fixture', 'prompt', 'check'])
      if (!t[k]) throw new Error(`task ${t.id ?? '?'}: missing "${k}"`);
    for (const p of [t.fixture, t.check.overlay])
      if (!existsSync(join(HERE, p))) throw new Error(`task ${t.id}: ${p} does not exist`);
    if (!Array.isArray(t.check.command))
      throw new Error(`task ${t.id}: check.command must be an argv array`);
  }
  return tasks;
}

const allArms = JSON.parse(readFileSync(join(HERE, 'arms.json'), 'utf8')).arms;
const armIds = opt('--arms', Object.keys(allArms).join(',')).split(',');
for (const a of armIds)
  if (!allArms[a])
    throw new Error(`unknown arm ${a}; arms.json has ${Object.keys(allArms).join(', ')}`);
const tasks = loadTasks();
const plan = planRuns({ tasks, arms: armIds, reps, seed });
const estimate = estimatePlan(plan, allArms, price);

const report = {
  schema: 'monomind.ab-eval/v1',
  generatedAt: new Date().toISOString(),
  mode: execute ? 'execute' : 'dry-run',
  runtime,
  model: model ?? null,
  reps,
  seed,
  maxUsd: opt('--max-usd') ? num('--max-usd') : null,
  price,
  estimate,
  spentUsd: 0,
  stoppedForBudget: false,
  runs: plan.map((r) => ({ task: r.task.id, arm: r.arm, rep: r.rep, status: 'planned' })),
  summary: {},
};
const save = () => outFile && writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `${tasks.length} tasks x ${armIds.length} arms (${armIds.join(', ')}) x ${reps} reps = ${plan.length} runs`,
);
console.log(
  `estimate at $${price.inPerMtok}/$${price.outPerMtok} per Mtok in/out (assumed tokens from arms.json):`,
);
for (const [arm, e] of Object.entries(estimate.perArm))
  console.log(
    `  ${arm.padEnd(6)} ${String(e.runs).padStart(3)} runs x $${e.perRunUsd.toFixed(2)} = $${e.usd.toFixed(2)}`,
  );
console.log(`  total  $${estimate.totalUsd.toFixed(2)}`);

if (!execute) {
  console.log(
    '\nDRY RUN: nothing spawned, $0 spent. Add --execute --max-usd N --model ID to spend money.',
  );
  save();
  process.exit(0);
}

if (!report.maxUsd) throw new Error('--execute needs --max-usd N (the hard spend cap)');
if (!model) throw new Error('--execute needs --model ID');
if (!existsSync(CLI)) throw new Error(`${CLI} is missing; run \`pnpm run build\` first`);
const guard = new SpendGuard(report.maxUsd);
if (estimate.totalUsd > report.maxUsd)
  console.log(
    `\nWARNING: estimate $${estimate.totalUsd.toFixed(2)} exceeds --max-usd $${report.maxUsd}; the run will stop at the cap.`,
  );

function runOnce(run) {
  const arm = allArms[run.arm];
  const estUsd = runCostUsd(arm.assume, price);
  const cap = Math.min(guard.remainingUsd, num('--run-cap-usd', 3 * estUsd));
  const ws = mkdtempSync(join(tmpdir(), `mm-ab-${run.task.id}-`));
  const env = { ...process.env, MONOMIND_NO_UPDATE_CHECK: '1' };
  const rec = { task: run.task.id, arm: run.arm, rep: run.rep };
  try {
    cpSync(join(HERE, run.task.fixture), ws, { recursive: true });
    const git = (...a) =>
      execFileSync('git', ['-c', 'user.name=ab', '-c', 'user.email=ab@example.invalid', ...a], {
        cwd: ws,
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'baseline');
    const s0 = Date.now();
    for (const step of arm.setup)
      execFileSync(process.execPath, [CLI, ...step], {
        cwd: ws,
        env,
        stdio: 'ignore',
        timeout: 300_000,
      });
    rec.setupMs = Date.now() - s0;

    const t0 = Date.now();
    const p = spawnSync(
      process.execPath,
      [
        CLI,
        'agent',
        'exec',
        '--runtime',
        runtime,
        '--model',
        model,
        '--prompt',
        run.task.prompt,
        '--cwd',
        ws,
        '--access',
        'full',
        '--settings',
        arm.settings,
        '--max-turns',
        String(run.task.maxTurns ?? 25),
        '--timeout',
        `${run.task.timeoutS ?? 600}s`,
        '--budget-usd',
        cap.toFixed(4),
      ],
      {
        cwd: ws,
        env,
        encoding: 'utf8',
        maxBuffer: 1 << 28,
        timeout: ((run.task.timeoutS ?? 600) + 60) * 1000,
      },
    );
    rec.wallMs = Date.now() - t0;
    const exec = parseExecOutput(p.stdout ?? '');
    const r = exec.result;
    rec.exitCode = exec.exitCode ?? p.status;
    rec.stopReason = r?.stop_reason ?? null;
    rec.error = exec.error;
    rec.tokens = r ? { input: r.input_tokens ?? 0, output: r.output_tokens ?? 0 } : null;
    rec.toolCalls = exec.toolCalls;
    const charged = guard.record(r?.cost_usd, estUsd);
    rec.costUsd = charged.costKnown ? charged.chargedUsd : null;
    rec.costKnown = charged.costKnown;

    cpSync(join(HERE, run.task.check.overlay), ws, { recursive: true });
    const c = spawnSync(run.task.check.command[0], run.task.check.command.slice(1), {
      cwd: ws,
      encoding: 'utf8',
      timeout: (run.task.check.timeoutS ?? 60) * 1000,
    });
    rec.checkExit = c.status;
    rec.success = c.status === 0;
    rec.status = 'done';
  } finally {
    if (!flag('--keep')) rmSync(ws, { recursive: true, force: true });
  }
  return rec;
}

for (let i = 0; i < plan.length; i++) {
  const run = plan[i];
  const estUsd = runCostUsd(allArms[run.arm].assume, price);
  if (report.stoppedForBudget || !guard.canStart(estUsd)) {
    report.stoppedForBudget = true;
    report.runs[i] = { ...report.runs[i], status: 'skipped', reason: 'budget' };
    continue;
  }
  try {
    report.runs[i] = runOnce(run);
  } catch (e) {
    report.runs[i] = {
      ...report.runs[i],
      status: 'skipped',
      reason: 'harness-error',
      error: String(e.message ?? e),
    };
  }
  report.spentUsd = guard.spentUsd;
  report.summary = summarizeRuns(report.runs);
  save();
  const r = report.runs[i];
  console.log(
    `[${i + 1}/${plan.length}] ${r.task} ${r.arm}#${r.rep} ${r.status}${r.success === undefined ? '' : r.success ? ' PASS' : ' FAIL'} spent $${guard.spentUsd.toFixed(2)}/${guard.maxUsd}`,
  );
}
report.summary = summarizeRuns(report.runs);
save();
console.log(
  `\nspent $${guard.spentUsd.toFixed(2)} of $${guard.maxUsd}${report.stoppedForBudget ? ' (stopped at the cap)' : ''}`,
);
console.log(JSON.stringify(report.summary, null, 2));
