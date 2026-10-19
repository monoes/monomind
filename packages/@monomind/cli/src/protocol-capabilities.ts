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
 *  - `agent-test-json` — `monomind agent test <id> [--model M] --json`: one
 *    "reply ok" turn reported as a single object with a `status` (ok,
 *    ok_unexpected, auth, quota, rate_limited (rev 20), model_unavailable,
 *    timeout, missing_binary, error), latency, tokens and cost (rev 18, issue #390)
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
 *  - `agent-exec-effort` — `agent exec --effort <level>` maps the turn's
 *    reasoning effort onto the runtime: claude (SDK `effort`) and codex
 *    (`-c model_reasoning_effort`) since rev 16; rev 19/20 extend it to the
 *    other runtimes whose `agent scan --json` entry has `effort: true`, and
 *    one with `effort: false` emits a `status` notice that it was ignored
 *    (§3.1)
 *  - `agent-exec-subagent-events` — claude runtime: `subagent` started/
 *    progress/finished events for native `Task`/`Agent` subagents, joined to
 *    the call's `tool_activity` id; a subagent's own text is an `assistant`
 *    event with `parent_tool_use_id` and stays out of `result.text` (§3.2.1,
 *    rev 17, issue #387). Rev 24: other runtimes get `started`/`finished`
 *    synthesized from a `kind:"task"` tool call's start and end
 *  - `agent-exec-full-access-any` — `agent exec --access full` on every
 *    runtime whose `agent scan --json` entry has `full_access: true` (not
 *    only claude), with process-group kill, `background_pids` and the audit
 *    line on each; `--settings` on a non-claude runtime leaves the CLI's own
 *    config un-isolated and emits a `status` naming what it loads; scan
 *    entries carry `resume`, `effort`, `max_turns`, `reports_cost`,
 *    `init_target`; `tool_activity` start events carry `kind` (§3, §6,
 *    rev 19)
 *  - `agent-exec-rate-limit-retry` — `agent exec` retries a turn that failed
 *    on a transient provider rate limit (429) up to 3 attempts with backoff,
 *    emitting a `status` notice before each retry; giving up is `error
 *    {code:"rate-limited", fatal:true}`, distinct from `quota` (§3.4, rev 20)
 *  - `agent-exec-access-read` — `agent exec --access read` (issue #388):
 *    native read tools, web, TodoWrite and caller tools, plus an allowlist of
 *    read-only shell commands (`git status|diff|log|show|blame`, `ls`, `cat`,
 *    `head`, `tail`, `wc`, `rg`, `grep`, `find` without actions that run or
 *    write; `--allow-bash-prefix` adds to it); no edits, general shell or
 *    subagents. claude enforces it itself; codex runs `--sandbox read-only`,
 *    pi/pi-rpc `--tools read,grep,find,ls`; any other runtime answers
 *    `unsupported`. `agent scan --json` entries carry `access_modes`
 *    (§3.1, §6, rev 21)
 *  - `agent-exec-full-access-tools` — `--tools stdio` caller tools together
 *    with `--access full` on every runtime whose scan entry has
 *    `caller_tools_with_full_access: true` (issue #389): exposed next to the
 *    native tools, same `tool_call`/`tool_result` frames and `--tool-timeout`
 *    as scoped mode; the calls of one assistant message are all sent to the
 *    caller before any result is awaited (results match by id, any order);
 *    scan entries carry `caller_tools` and `caller_tools_with_full_access`
 *    (§3.1, §4.3, §6, rev 22)
 *  - `agent-exec-sandbox` — `agent exec --sandbox read-only|workspace-write|
 *    full` (issue #396): the vendor CLI's own sandbox where one exists
 *    (codex, grok, dsh; `full` = today's default everywhere, any other
 *    mode on another runtime is `unsupported`); never loosens an org role's
 *    git level; `start` carries `native_sandbox` and `approvals`, scan
 *    entries carry them plus `sandbox_modes` (§3.1, §3.2, §6, rev 23)
 *  - `agent-test-sandbox` — `agent test <id> --json` accepts `--sandbox` and
 *    `--env` as `agent exec` does, and the result carries `native_sandbox`
 *    (issue #474, §13)
 *  - `agent-exec-sandbox-restricted` — `--sandbox restricted` (issue #482):
 *    the CLI's own approval rules apply and every call they would ask about
 *    is refused (copilot, antigravity, opencode). Same rev: copilot gains
 *    read-only/workspace-write, pi/pi-rpc read-only, claude read-only/
 *    workspace-write in scoped/read access (`native_sandbox: "monomind"`)
 *    (§3.1, §3.2, §6, rev 26)
 *  - `agent-exec-sandbox-fallback` — `agent exec|test --sandbox-fallback
 *    fail|strictest|run` (issue #482): `fail` (default) keeps the
 *    `unsupported` error; `strictest` runs the closest supported mode at
 *    least as strict as the request (else the strictest there is); `run`
 *    runs the runtime default. A replaced mode emits `status
 *    {phase:"notice"}`; `start` carries `sandbox_requested` and
 *    `sandbox_applied`, scan entries `sandbox_mode_reports` (§3.1, §3.2,
 *    §6, §13, rev 26)
 *  - `agent-exec-cost-null` — an unknown cost is `null`, never `0`:
 *    `usage`/`result` `cost_usd` on `agent exec`, `agent test --json`'s
 *    `cost_usd`, and org `usage` events / `org report|costs --json` totals
 *    when the runtime reported no cost (§3.2, §13, rev 28)
 *  - `agent-models-alias-of` — `agent models --json` keeps every entry and
 *    marks one that resolves to the same model as an earlier entry with
 *    `alias_of: <canonical id>`; the canonical entry lists `aliases` (§12,
 *    rev 28)
 *  - `org-sign-check` — `org sign <org>|--all --check [--format json]`
 *    reports each org's signature state without prompting, signing or
 *    writing, and `--project <dir>` names the project root (issue #561,
 *    doc/commands/org.md; §7.2, rev 29)
 *  - `org-sign-expect-hash` — `org sign --expect-hash <hex>` (with `--all`,
 *    `<org>=<hex>` per org) signs only the hash the caller computed, else
 *    exits 1 and writes nothing; `--check --format json` entries carry that
 *    `hash`. Since the same rev `org sign` exits 2 on any option it does not
 *    know and signs nothing (§7.2, rev 29)
 *  - `org-sign-review-json` — `org sign <org> --format json` without `--yes`
 *    prints the review (what signing would approve) with its `hash` as one
 *    JSON object and signs nothing, even on a TTY (§7.2, rev 29)
 *  - `agent-exec-attachments` — `agent exec --attach FILE` (repeatable, at
 *    most 10 files of 20 MB each; anything else is a usage error, exit 2):
 *    claude gets PNG/JPEG/GIF/WebP as `image` and PDF as `document` content
 *    blocks, codex gets images as `--image`, and every other file or runtime
 *    gets an "Attached files:" block of absolute paths after the prompt
 *    (§3.1, rev 32)
 */
export const AGENT_PROTOCOL_CAPABILITIES = [
  'agent-exec',
  'agent-exec-full-access',
  'agent-exec-settings',
  'agent-exec-tool-activity',
  'agent-exec-background-pids',
  'agent-exec-full-access-any',
  'agent-exec-effort',
  'agent-scan',
  'agent-scan-read-only',
  'agent-models',
  'agent-test-json',
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
  'agent-exec-subagent-events',
  'agent-exec-rate-limit-retry',
  'agent-exec-access-read',
  'agent-exec-full-access-tools',
  'agent-exec-sandbox',
  'agent-test-sandbox',
  'agent-exec-sandbox-restricted',
  'agent-exec-sandbox-fallback',
  'agent-exec-cost-null',
  'agent-models-alias-of',
  'org-sign-check',
  'org-sign-expect-hash',
  'org-sign-review-json',
  'agent-exec-attachments',
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
