---
name: mastermind-createorg
description: Mastermind createorg — design and persist an autonomous agent organization (Org Runtime v2) as a `.monomind/orgs/<name>.json` config that `monomind org run/serve` loads directly. Supports optional --schedule flag for daemon-scheduled orgs.
type: domain-skill
default_mode: confirm
---

# Mastermind Create Org

This skill is invoked by `mastermind:createorg` or directly via `/mastermind:createorg`.

Org Runtime v2 (`packages/@monomind/cli/src/orgrt/`) is a Node daemon, not a Task-tool-spawned boss agent. Every role in the config becomes a live SDK agent session (`@anthropic-ai/claude-agent-sdk` `query()`) the moment the org starts — there is no task board, no per-role generated `.claude/agents/*.md` file, and no communication-topology array. Roles address each other directly with the `org_send` tool using their `id` (or `<org>:<id>` cross-org). This skill's only job is to produce a config that validates against `OrgDefSchema` (`packages/@monomind/cli/src/orgrt/types.ts`).

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `prompt`: goal and/or role description for this org
- `org_name`: desired name for the org (slug, e.g. `content-team`); constrained to `[a-z0-9-]`
- `roles_desc`: optional explicit role list from user (e.g. "boss, content writer, reviewer, marketer, designer")
- `schedule`: optional schedule string in daemon format — `"<N>s"`, `"<N>m"`, or `"<N>h"` (e.g. `"30m"`, `"2h"`). When provided, the org is picked up by `monomind org serve` on its own interval; omit for a one-shot `monomind org run`.
- `budget_tokens`: optional total token budget for the org run (default 1,000,000 — split evenly across roles by the daemon)
- `mode`: auto | confirm
- `session_id`: session ID passed by command wrapper (snake_case input)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command" (i.e. invoked directly, not by the command wrapper), load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

If `caller` is "command", use the `brain_context` already provided.

Run intake from `_intake.md` if `prompt` is vague (stop at Q3, domain is `ops`). Skip intake if `prompt` is a rich prompt per _intake.md criteria.

---

## Step 1 — Resolve Org Name

If `org_name` is not provided, extract the most prominent product/team noun from `prompt`, slugify it (lowercase, spaces → hyphens, strip non-`[a-z0-9-]` chars), and confirm with the user. Fallback: `org-<YYYYMMDD>`.

Reject any `org_name` that does not match `^[a-z0-9][a-z0-9-]{0,63}$` (the CLI's own `ORG_NAME_RE` in `org.ts` is slightly looser — `^[a-z0-9][a-z0-9_-]*$/i` — but this skill's stricter slug is always a valid subset).

---

## Step 2 — Ingest Roles

Parse `roles_desc` (if provided) into a list of role titles. If not provided, derive a set of roles from `prompt` by identifying the human functions needed to achieve the goal.

**Required roles to include when deriving roles from the prompt** (**skip this rule for persona-based orgs**, see below, where the characters themselves define the structure):
- A coordinator/boss role that owns the goal — exactly one role with `reports_to: null`
- At least one executor role that does the primary work
- A reviewer role if quality output is implied

**If the user provided an explicit `roles_desc`, their list is authoritative — never silently inject roles into it.** If a structural role above is missing (e.g. no coordinator), in confirm mode note the gap in the Step 4 plan as a one-line suggestion; in auto mode, create exactly the roles listed and let the first one default to boss (Step 2.2).

**Step 2.1 — Assign `id`, `title`, `type`, `reports_to`.**

- `id`: slug derived from title (`Content Writer` → `content-writer`)
- `title`: display title, as given
- `type`: `"boss"` for the single root role (the daemon looks for `type === 'boss' || reports_to === null`, falling back to `roles[0]` if neither matches), `"specialist"` for everyone else — or a domain-fit synonym like `"reviewer"` / `"researcher"` purely for readability; the runtime treats `type` as free text except for the `"boss"` match
- `reports_to`: the boss's `id` for direct reports, `null` only for the boss; for larger teams a middle layer can report to another non-boss role — the runtime does not enforce a shape beyond "each role's `reports_to` must be another role's `id` or null"

Exactly one role must have `reports_to: null`. If the user's role list has none, promote the first/most senior-sounding role. If it has more than one, ask which is the root (confirm mode) or promote the first one listed (auto mode).

**Step 2.2 — Persona / Character Detection.**

A role is **persona-based** if its title is a named real person, a well-known fictional character, or a celebrity/historical figure referred to by name. An org is persona-based if ≥50% of its roles are character names, or the goal/prompt contains `panel`, `debate`, `simulation`, `roleplay`, `celebrity`, `character`, `virtual [name]`, `impersonate`, `as [name]`.

Persona roles work the same as any other role in v2 — there is no separate `agent_type`/subagent registry to resolve against. Put the character depth directly into `responsibilities` (the only field `buildRolePrompt` — `orgrt/session.ts:27-39` — actually feeds into the agent's role briefing): write 3-6 specific, voice-defining responsibilities drawn from the character's known career, positions, and communication style, not generic duties. For a living public figure, base it on documented public behavior — do not invent positions they haven't taken.

---

## Step 2.3 — Optional Per-Role Settings

For any role that needs non-default behavior, set (all optional — omit to inherit defaults):

- `adapter_config.model`: a model id (e.g. `"claude-opus-4-7"`) — default is `"claude-sonnet-4-5"` (`orgrt/types.ts:33`)
- `provider`: `{ kind: "subscription" | "api-key" | "base-url" | "bedrock" | "vertex", apiKeyEnv?, baseUrl?, authTokenEnv? }` — default `subscription` (local Claude Code login); only set this if the role needs a different provider/credential
- `policy`: `{ allowTools?, denyTools?, fileWrite?, fileRead?, webAllow?, maxTokens? }` — glob-based tool/file/web restrictions for that role; leave unset unless the user asked for sandboxing

Do not invent values for these — only populate a field the user actually specified or clearly implied (e.g. "the researcher should use Opus" → that role's `adapter_config.model`).

---

## Step 3 — Build Org Config

Produce an org config object matching `OrgDefSchema` exactly:

```json
{
  "name": "<org_name>",
  "goal": "<the goal the org exists to achieve>",
  "status": "stopped",
  "schedule": "<'<N>m' | '<N>h' | '<N>s' from Step 0 input, or null for a one-shot org>",
  "run_config": {
    "max_concurrent_agents": 4,
    "budget_tokens": "<budget_tokens input, or 1000000 default>",
    "memory_namespace": "org:<org_name>",
    "max_turns_per_message": 30
  },
  "roles": [
    {
      "id": "<slug>",
      "title": "<display title>",
      "type": "boss | specialist | <domain synonym>",
      "reports_to": "<role id, or null for the single boss>",
      "responsibilities": ["<3-6 specific duties — this text becomes part of the agent's role briefing>"]
    }
  ]
}
```

`status` starts `"stopped"` regardless of whether `schedule` is set — the org does not run until `monomind org run <name>` (one-shot) or `monomind org serve` (picks up any org whose `schedule` is set) is invoked.

Only include `adapter_config`, `provider`, or `policy` on a role when Step 2.3 populated them for it — leave them out entirely rather than writing empty objects.

---

## Step 4 — Show Plan and Confirm (confirm mode)

Render the org plan in a clear human-readable format:

```
╔══════════════════════════════════════════════════╗
║  ORG: <org_name>                                 ║
║  GOAL: <goal>                                    ║
╚══════════════════════════════════════════════════╝

ROLES  (N roles — exactly one boss, every reports_to resolves to a real role id)
─────
• [boss] CEO / Boss  (type: boss, reports_to: none)
    Responsibilities: Strategic oversight, final decisions, coordinates the team via org_send

• [content_writer] Content Writer  (type: specialist, reports_to: boss)
    Responsibilities: Draft posts per the content calendar, hand off to content_reviewer

  ... (all roles)

SETTINGS
────────
Budget: <run_config.budget_tokens> tokens (split evenly across N roles)
Memory namespace: org:<org_name>
Schedule: <"every <N> <unit>" if schedule set; otherwise "manual — run with `monomind org run <org_name>`">

Type "go" to save this org, or describe changes.
```

In **auto** mode, skip the confirmation prompt.

If the user requests changes, apply them and re-render. Repeat until confirmed.

---

## Step 5 — Save Org Config

```bash
org_name="<resolved org name from Step 1>"
orgJson=".monomind/orgs/${org_name}.json"
mkdir -p .monomind/orgs
```

Write the confirmed org config as JSON using `jq` to guarantee valid encoding:

```bash
# Set shell variables from the confirmed plan before running this block:
#   goal, schedule_val ("" if none), budget_tokens_val, roles_json (JSON array matching the role shape above)
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg schedule "${schedule_val:-}" \
  --argjson budget_tokens "${budget_tokens_val:-1000000}" \
  --argjson roles "$roles_json" \
  '{name:$name,goal:$goal,status:"stopped",
    schedule:(if $schedule=="" then null else $schedule end),
    run_config:{max_concurrent_agents:4,budget_tokens:$budget_tokens,
                memory_namespace:("org:"+$name),max_turns_per_message:30},
    roles:$roles}' \
  > "${orgJson}.tmp" && mv "${orgJson}.tmp" "$orgJson"
```

**POST-SAVE VALIDATION (run immediately after saving — abort if any check fails):**

```bash
# Check 1 — exactly one root role (reports_to null)
root_count=$(jq '[.roles[] | select(.reports_to == null)] | length' "$orgJson")
if [ "$root_count" -ne 1 ]; then
  echo "ERROR: expected exactly one role with reports_to: null, found $root_count — fix the roles array and re-save."
  exit 1
fi
echo "✓ Exactly one root role"

# Check 2 — every non-root role's reports_to resolves to a real role id
bad_reports=$(jq -r '
  ([.roles[].id]) as $ids |
  [.roles[] | select(.reports_to != null and (.reports_to as $r | $ids | index($r) | not)) | .id]
  | join(", ")' "$orgJson")
if [ -n "$bad_reports" ]; then
  echo "ERROR: these roles have a reports_to that doesn't match any role id: $bad_reports"
  exit 1
fi
echo "✓ All reports_to values resolve"

# Check 3 — schema sanity check via the CLI itself (parses with OrgDefSchema, same code path org run/serve use)
npx monomind@latest org list >/dev/null 2>&1 || echo "WARNING: could not verify via CLI — check .monomind/orgs manually"

echo "✓ Org config validated — ready for: monomind org run ${org_name}"
```

---

## Step 6 — Return Output

```yaml
domain: ops
status: complete
artifacts:
  - path: .monomind/orgs/<org_name>.json
    type: config
decisions:
  - what: "Org <org_name> created with N roles"
    why: "Role mapping derived from goal and user description"
    confidence: 0.85
    outcome: shipped
lessons:
  - what_worked: "Auto-suggested roles matched user intent"
  - what_didnt: ""
next_actions:
  - "Run `monomind org run <org_name>` to start the organization in the foreground"
  - "Or `monomind org serve` to host it (and any other scheduled orgs) as a background daemon"
  - "Edit .monomind/orgs/<org_name>.json directly, or use /mastermind:org-settings, to change goal/budget/roles"
  - "`monomind org status <org_name>` to check runtime state; `monomind org stop <org_name>` to stop a running org"
```

Print confirmation:
```
✓ Org "<org_name>" saved to .monomind/orgs/<org_name>.json
  → Run: monomind org run <org_name>
```

If `schedule` was set, also print:
```
  Schedule: every <N> <unit> — pick it up with: monomind org serve
```

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
