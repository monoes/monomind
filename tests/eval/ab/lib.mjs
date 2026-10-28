// Pure helpers of the paid A/B runner (tests/eval/ab/run.mjs): run planning,
// cost estimate, the hard spend guard, `agent exec` NDJSON parsing and result
// summaries. No I/O, no spawning; unit-tested in lib.test.ts.

/** Deterministic PRNG (mulberry32) so a seed fixes the run order. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Every (task, arm, rep) once, in a seeded random order so a slow hour or a
 * rate-limit window does not fall on one arm.
 */
export function planRuns({ tasks, arms, reps, seed = 1 }) {
  const runs = [];
  for (const task of tasks)
    for (let rep = 1; rep <= reps; rep++) for (const arm of arms) runs.push({ task, arm, rep });
  const rand = rng(seed);
  for (let i = runs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [runs[i], runs[j]] = [runs[j], runs[i]];
  }
  return runs;
}

/** USD for one run from assumed token counts; prices are USD per million tokens. */
export function runCostUsd({ inputTokens, outputTokens }, price) {
  return (inputTokens * price.inPerMtok + outputTokens * price.outPerMtok) / 1e6;
}

/** Estimated total and per-arm cost of a plan, from each arm's assumed tokens per run. */
export function estimatePlan(runs, armSpecs, price) {
  const perArm = {};
  let total = 0;
  for (const r of runs) {
    const usd = runCostUsd(armSpecs[r.arm].assume, price);
    perArm[r.arm] ??= { runs: 0, perRunUsd: usd, usd: 0 };
    perArm[r.arm].runs += 1;
    perArm[r.arm].usd += usd;
    total += usd;
  }
  return { totalUsd: total, perArm };
}

/**
 * Hard spend cap. A run may start only if what was spent plus its estimate
 * fits; a run whose cost the runtime did not report is charged its estimate
 * (unknown is never free).
 */
export class SpendGuard {
  constructor(maxUsd) {
    if (!(maxUsd > 0) || !Number.isFinite(maxUsd))
      throw new Error('--max-usd must be a positive number');
    this.maxUsd = maxUsd;
    this.spentUsd = 0;
  }
  get remainingUsd() {
    return Math.max(0, this.maxUsd - this.spentUsd);
  }
  canStart(estimateUsd) {
    return this.spentUsd + estimateUsd <= this.maxUsd;
  }
  record(costUsd, estimateUsd) {
    const known = typeof costUsd === 'number' && Number.isFinite(costUsd);
    this.spentUsd += known ? costUsd : estimateUsd;
    return { chargedUsd: known ? costUsd : estimateUsd, costKnown: known };
  }
}

/** What one `agent exec` turn reported, from its NDJSON stdout (protocol 3.2). Unparsable lines are ignored. */
export function parseExecOutput(stdout) {
  const out = {
    result: null,
    error: null,
    exitCode: null,
    toolCalls: { total: 0, byKind: {}, monomind: 0 },
  };
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === 'result') out.result = e;
    else if (e.type === 'error') out.error ??= { code: e.code, message: e.message };
    else if (e.type === 'done') out.exitCode = e.exit_code;
    else if (e.type === 'tool_activity' && e.phase === 'start') {
      const t = out.toolCalls;
      t.total += 1;
      t.byKind[e.kind ?? 'other'] = (t.byKind[e.kind ?? 'other'] ?? 0) + 1;
      if (typeof e.name === 'string' && /^mcp__monomind__/.test(e.name)) t.monomind += 1;
    }
  }
  return out;
}

/** Wilson score interval for a success rate. */
export function wilson(successes, n, z = 1.96) {
  if (n === 0) return { rate: 0, lo: 0, hi: 0 };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { rate: p, lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Per-arm summary of finished runs ({arm, status:'done'|'skipped', success,
 * tokens:{input,output}, costUsd, wallMs}). Skipped runs (budget stop) are
 * counted but excluded from every rate. Cost/token means use only runs that
 * reported them.
 */
export function summarizeRuns(runs) {
  const arms = {};
  for (const arm of new Set(runs.map((r) => r.arm))) {
    const all = runs.filter((r) => r.arm === arm);
    const done = all.filter((r) => r.status === 'done');
    const ok = done.filter((r) => r.success);
    const tokens = done.filter((r) => r.tokens).map((r) => r.tokens.input + r.tokens.output);
    const costs = done.filter((r) => typeof r.costUsd === 'number').map((r) => r.costUsd);
    const wall = done.map((r) => r.wallMs);
    arms[arm] = {
      runs: all.length,
      completed: done.length,
      skipped: all.length - done.length,
      success: { count: ok.length, ...wilson(ok.length, done.length) },
      tokensMean: mean(tokens),
      tokensMedian: median(tokens),
      costUsdMean: mean(costs),
      costUsdTotal: costs.reduce((a, b) => a + b, 0),
      wallMsMean: mean(wall),
      wallMsMedian: median(wall),
      // cost and tokens per SUCCESSFUL run: what an accepted result actually cost
      costUsdPerSuccess: ok.length ? costs.reduce((a, b) => a + b, 0) / ok.length : null,
    };
  }
  return arms;
}
