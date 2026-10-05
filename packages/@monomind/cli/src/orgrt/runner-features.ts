// packages/@monomind/cli/src/orgrt/runner-features.ts
/**
 * Coder mode on every runtime: the per-runtime service flags `agent scan
 * --json` reports (doc/agent-exec-protocol.md §6, rev 19) so a caller can
 * say honestly what a runtime gives a coder turn. Kept out of
 * runner-registry.ts (near the 500-line limit) and merged into each
 * `RunnerSpec` there. `Record<RuntimeKind, …>` makes a new runtime a
 * compile error until it is listed here.
 *
 * Each flag states what the RUNNER implements today, not what the vendor
 * CLI could do:
 *   resume      — the runner honors `AgentRunArgs.resume` (agent exec
 *                 `--resume <session_id>`) and yields a session id to resume.
 *   effort      — the runner maps `AgentRunArgs.effort` (agent exec
 *                 `--effort`) onto the CLI; others ignore it with a status
 *                 notice.
 *   maxTurns    — the runner enforces `AgentRunArgs.maxTurns` on the
 *                 runtime's native agent loop.
 *   reportsCost — `result.cost_usd` is a real USD figure (a runner that
 *                 reports a constant 0 does not count), so a USD budget can
 *                 trip.
 *   initTarget  — the `monomind init --target` value that writes this
 *                 runtime's setup files, or null when init has none.
 *                 `agents` (AGENTS.md only, no Claude files) for the
 *                 runtimes that read AGENTS.md natively and have no
 *                 target of their own.
 */

import type { RuntimeKind } from './daemon.js';

export interface RunnerFeatures {
  resume: boolean;
  effort: boolean;
  maxTurns: boolean;
  reportsCost: boolean;
  initTarget:
    | 'claude'
    | 'codex'
    | 'opencode'
    | 'kimicode'
    | 'antigravity'
    | 'cline'
    | 'aider'
    | 'agents'
    | null;
}

export const RUNNER_FEATURES: Record<RuntimeKind, RunnerFeatures> = {
  freebuff: { resume: false, effort: false, maxTurns: false, reportsCost: false, initTarget: null },
  kilo: { resume: true, effort: false, maxTurns: false, reportsCost: true, initTarget: null },
  claude: { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'claude' },
  // effort: codex `-c model_reasoning_effort`, opencode model variant, agy
  // `--effort`, grok/copilot `--reasoning-effort` (each runner's own mapping).
  codex: { resume: true, effort: true, maxTurns: false, reportsCost: false, initTarget: 'codex' },
  // cost: the served instance reports per-message USD (opencode-runner.ts).
  opencode: {
    resume: true,
    effort: true,
    maxTurns: false,
    reportsCost: true,
    initTarget: 'opencode',
  },
  vercel: { resume: true, effort: false, maxTurns: true, reportsCost: false, initTarget: null },
  antigravity: {
    resume: true,
    effort: true,
    maxTurns: false,
    reportsCost: false,
    initTarget: 'antigravity',
  },
  kimicode: {
    resume: true,
    effort: false,
    maxTurns: false,
    reportsCost: false,
    initTarget: 'kimicode',
  },
  // grok: --max-turns per invocation; cost is result.total_cost_usd, which
  // grok's docs say falls back to 0 when it cannot price the turn.
  grok: { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'agents' },
  qwen: { resume: true, effort: false, maxTurns: false, reportsCost: false, initTarget: 'agents' },
  // Resume is per-process only (the rpc session lives as long as the child).
  'qwen-rpc': {
    resume: false,
    effort: false,
    maxTurns: false,
    reportsCost: false,
    initTarget: 'agents',
  },
  // crush resumes with --continue inside one run only; no id to hand back.
  crush: {
    resume: false,
    effort: false,
    maxTurns: false,
    reportsCost: false,
    initTarget: 'agents',
  },
  // copilot: the closing result line carries sessionId; --resume=<id>.
  copilot: {
    resume: true,
    effort: true,
    maxTurns: false,
    reportsCost: false,
    initTarget: 'agents',
  },
  // pi / pi-rpc (#381): resume is `--session-id <id>`, an id the runner
  // picks (sessions stay in pi's own store); effort maps 1:1 to `--thinking
  // off|low|medium|high|xhigh|max`; maxTurns is emulated (turn_start count,
  // then kill / rpc `abort`); cost is the sum of every assistant message_end's
  // cost.total (0 for models pi cannot price). pi reads AGENTS.md natively:
  // init target `agents` (AGENTS.md only).
  pi: { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'agents' },
  'pi-rpc': { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'agents' },
  // cline (#382): a fresh turn runs `--json` (tokens and cost from
  // run_result, effort → --thinking); later turns run over ACP session/load
  // (usage = growth of the `cline history` totals; no effort on resumed
  // turns); maxTurns is emulated (iteration_start / model steps, then kill;
  // can overshoot by one step).
  cline: { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'cline' },
  // aider (#383, via the Python shim): per-session JSON history in the state
  // dir; effort → reasoning_effort / thinking_tokens; maxTurns caps aider's
  // retry loop; cost from coder.total_cost.
  aider: { resume: true, effort: true, maxTurns: true, reportsCost: true, initTarget: 'aider' },
  // dsh (#384): `--session-id`; model and effort go through a generated
  // --patch over the agent-default-model row (DeepSeek routes use
  // off|low|high|max; a curated pi-ai model is clamped to its own levels);
  // maxTurns emulated (step_start count + process-group kill). No USD cost.
  // dsh reads AGENTS.md natively: init target `agents`.
  dsh: { resume: true, effort: true, maxTurns: true, reportsCost: false, initTarget: 'agents' },
  // hermes reports no cost (result.cost_usd is null).
  hermes: { resume: false, effort: false, maxTurns: false, reportsCost: false, initTarget: null },
};
