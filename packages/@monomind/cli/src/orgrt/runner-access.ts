// packages/@monomind/cli/src/orgrt/runner-access.ts
/**
 * Per-runtime `agent exec --access` support beyond `scoped`/`full`
 * (doc/agent-exec-protocol.md §3.1/§6). Merged into each `RunnerSpec` by
 * runner-registry.ts, like runner-features.ts. `Record<RuntimeKind, …>`
 * makes a new runtime a compile error until it is listed here.
 *
 * `readAccess` (#388, rev 21) is true only where `--access read` is enforced
 * by something that really exists and was checked, never by prompt text:
 *   claude    — agent-exec-read.ts's canUseTool + PreToolUse gate.
 *   codex     — `codex exec --sandbox read-only` (codex-cli 0.156.1 --help;
 *               `codex sandbox -c sandbox_mode="read-only"` refused a write
 *               with "Read-only file system").
 *   pi/pi-rpc — `--tools read,grep,find,ls`, the read-only mode `pi --help`
 *               documents (pi 0.87).
 * Every other runtime answers `--access read` with `unsupported`. Not
 * opencode: its permission config decodes built-in keys (read, edit, bash,
 * …) ahead of a `"*"` key and rules are last-match-wins (checked in the
 * opencode 1.18.32 binary: StructWithRest schema, `findLast`), so a
 * deny-by-default `"*": "deny"` overrides every `allow`, while leaving `"*"`
 * out lets unlisted tools (user MCP servers) fall through to opencode's own
 * defaults. No verified read-only mode, so no `read`.
 *
 * `callerTools` (#389, rev 22): the runner exposes `--tools stdio` caller
 * tools to the model and routes each call to its handler (the stdio bridge).
 * claude and vercel register them as native tools; every other runner
 * renders the fence protocol (tool-fence.ts) and runs the calls through
 * `runToolRound`, in every access mode. `callerToolsWithFullAccess` is
 * derived: callerTools && supportsFullAccess (the full-access path hands
 * the same tools and the allow-all gate to the same runner code).
 */

import type { RuntimeKind } from './daemon.js';

export interface RunnerAccess {
  /** Explicit false when even default scoped execution cannot be confined. */
  scopedAccess?: boolean;
  /** `agent exec --access read` is implemented for this runtime. */
  readAccess: boolean;
  /** `--tools stdio` caller tools reach the model on this runtime. */
  callerTools: boolean;
}

const NO_READ: RunnerAccess = { readAccess: false, callerTools: true };
const READ: RunnerAccess = { readAccess: true, callerTools: true };

export const RUNNER_ACCESS: Record<RuntimeKind, RunnerAccess> = {
  freebuff: { readAccess: false, callerTools: false },
  kilo: { scopedAccess: false, readAccess: false, callerTools: false },
  claude: READ,
  codex: READ,
  pi: READ,
  'pi-rpc': READ,
  opencode: NO_READ,
  vercel: NO_READ,
  antigravity: NO_READ,
  kimicode: NO_READ,
  grok: NO_READ,
  qwen: NO_READ,
  'qwen-rpc': NO_READ,
  crush: NO_READ,
  copilot: NO_READ,
  hermes: NO_READ,
  cline: NO_READ,
  aider: NO_READ,
  dsh: NO_READ,
};

/** The `--access` values a runtime accepts, as `agent scan --json` lists them. */
export function accessModes(spec: {
  readAccess: boolean;
  supportsFullAccess: boolean;
  executionUnsupportedReason?: string;
  scopedAccess?: boolean;
}): Array<'scoped' | 'read' | 'full'> {
  if (spec.executionUnsupportedReason) return [];
  return [
    ...(spec.scopedAccess === false ? [] : (['scoped'] as const)),
    ...(spec.readAccess ? (['read'] as const) : []),
    ...(spec.supportsFullAccess ? (['full'] as const) : []),
  ];
}

/** #389: caller tools together with `--access full` on this runtime. */
export function callerToolsWithFullAccess(spec: {
  callerTools: boolean;
  supportsFullAccess: boolean;
}): boolean {
  return spec.callerTools && spec.supportsFullAccess;
}
