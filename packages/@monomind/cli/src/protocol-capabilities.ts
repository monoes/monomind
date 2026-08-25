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
 */
export const AGENT_PROTOCOL_CAPABILITIES = ['agent-exec', 'agent-scan', 'org-json-v1'] as const;

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
