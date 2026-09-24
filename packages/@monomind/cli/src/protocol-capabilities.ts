/**
 * Agent Exec Protocol capabilities — the version handshake payload.
 *
 * Lives in its own dependency-free module (NOT orgrt/agent-exec.ts) because
 * the CLI entrypoint (src/index.ts) imports it on the `--version --json`
 * path, which must stay lazy-load-free — pulling agent-exec.ts here would
 * drag the Claude Agent SDK into every `monomind --version` invocation.
 *
 * Spec: doc/agent-exec-protocol.md §2.
 */

/** Protocol revision implemented by this monomind build. */
export const AGENT_PROTOCOL_VERSION = 1;

/** Advisory minimum caller version (semver). Callers compare, never execute. */
export const AGENT_PROTOCOL_MIN_CALLER = '1.0.0';

/**
 * Capability strings advertised by `monomind --version --json`:
 *  - `agent-exec`   — `monomind agent exec` (§3)
 *  - `agent-scan`   — `monomind agent scan --json` (§6)
 *  - `org-json-v1`  — `--json`/`--format json` output on org observe commands (§7)
 *  - `org-tool-providers` — role `tool_providers` (stdio MCP), `policy.approvalTools`,
 *    operator-authenticated `/api/xdeliver` and live `org inbox --format json`
 *  - `org-decision-attribution` — `--by`/`resolvedBy`, `decision-resolved` audit
 *    events, request-scoped approvals (`--request`, `requestId`)
 *  - `org-endpoint-roles` — roles with `kind: "endpoint"` delivered by HTTP POST
 *  - `org-federation` — `federation.allow_from/allow_to` enforced across project roots
 *  - `org-idle-deadline` — `org status --json` reports `idle_stop_at`,
 *    `idle_stop_in_seconds`, `idle_hold` and `idle_hold_until` for a running
 *    org (every hold carries a deadline — ADR-O001 D4)
 *  - `doctor-json` — `doctor --json` prints its results as JSON (each with its
 *    component id and fix safety), and `doctor --fix --json` / `--install
 *    --json` add the fix outcomes (doc/agent-exec-protocol.md §10)
 */
export const AGENT_PROTOCOL_CAPABILITIES = [
  'agent-exec',
  'agent-scan',
  'org-json-v1',
  'org-tool-providers',
  'org-decision-attribution',
  'org-endpoint-roles',
  'org-federation',
  'org-idle-deadline',
  'doctor-json',
] as const;

/** The exact handshake object emitted by `monomind --version --json`. */
export function versionJsonPayload(version: string): {
  v: number;
  version: string;
  min_caller: string;
  capabilities: readonly string[];
} {
  return {
    v: AGENT_PROTOCOL_VERSION,
    version,
    min_caller: AGENT_PROTOCOL_MIN_CALLER,
    capabilities: AGENT_PROTOCOL_CAPABILITIES,
  };
}
