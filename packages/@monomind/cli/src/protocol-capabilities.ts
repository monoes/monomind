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
 *  - `agent-scan-read-only` — `agent scan` runs no runtime binary unless it is
 *    known to be side-effect free or `--probe` is given; entries carry
 *    `version_source` (§6, rev 11)
 *  - `agent-models` — `monomind agent models --runtime <id> --json`: the
 *    runtime's own model list (§12, issue #369)
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
 *  - `doctor-read-only` — `doctor --json` (without `--fix`/`--install`) and
 *    `doctor --read-only` change no file; the payload carries `read_only` (§10)
 *  - `doctor-offline` — `doctor --offline` skips the checks that use the
 *    network and reports them as `skipped` with `skipped_reason` (§10)
 *  - `agent-exec-full-access` — `agent exec --access full` (claude runtime):
 *    unrestricted native tool access, `start.access`, `agent scan --json`'s
 *    `full_access` field (§3.1/§3.2/§3.4)
 *  - `agent-exec-settings` — `agent exec --settings none|<csv of
 *    user,project,local>` (coder mode, claude runtime): loads CLAUDE.md,
 *    skills, hooks, and project+user MCP servers; the `status` event and its
 *    startup watchdog (§3.1, §3.2)
 *  - `agent-exec-tool-activity` — `tool_activity` start/end events for
 *    NATIVE tool calls on `agent exec` stdout, in every access mode (§3.2)
 *  - `init-json` — `monomind init --json` prints `{root, created, skipped,
 *    claude_project_registered, duration_ms}` on stdout, human output
 *    suppressed; `--project <dir>`, `--if-missing` (idempotent, never
 *    touches an existing file), `--no-graph`, and `--register-claude-project`
 *    (doc/agent-exec-protocol.md §11)
 *  - `agent-exec-background-pids` — `--access full` spawns the `claude` CLI
 *    as the leader of its own process group; `cancel`/`--timeout`/
 *    `--budget-usd` kill the whole group (Bash-tool grandchildren and `&`
 *    background jobs included), and `done` gains `background_pids` listing
 *    survivors still alive after a NORMAL end_turn (§3.2)
 *  - `org-role-full-access` — per-role `policy.access: "full"` (Coder mode
 *    epic #364, issue #365): human-only grant via
 *    `monomind org role set-access <org> <role> full|scoped`, an
 *    `access_ack` hash covering the role's security-relevant config, an
 *    unattended-run gate (`run_config.allow_unattended_full_access`) and
 *    taint checks in `org validate`. `org status --json` gains
 *    `roles_access` (§7.2) for any role that declares it.
 *  - `knowledge-profile-captures` — a capture envelope naming a `profile`
 *    ingests into `profile:<id>` (query-string URLs included), its
 *    `transcript.md`/`summary.md` are their own documents beside
 *    `readable.md`, and `doc search|cite|related|lookup|list --scope
 *    profile:<id>` read that store (rev 15)
 */
export const AGENT_PROTOCOL_CAPABILITIES = [
  'agent-exec',
  'agent-exec-full-access',
  'agent-exec-settings',
  'agent-exec-tool-activity',
  'agent-exec-background-pids',
  'agent-scan',
  'agent-scan-read-only',
  'agent-models',
  'org-json-v1',
  'org-tool-providers',
  'org-decision-attribution',
  'org-endpoint-roles',
  'org-federation',
  'org-idle-deadline',
  'org-role-full-access',
  'doctor-json',
  'doctor-read-only',
  'doctor-offline',
  'init-json',
  'knowledge-profile-captures',
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
