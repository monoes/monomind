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
- `max_run`: optional, same format as `schedule`. See the run_config note below — always set it for a scheduled org.
- `budget_tokens`: optional total token budget for the org run (default 1,000,000 — split evenly across roles by the daemon)
- `max_run`: optional wall-clock bound on ONE scheduled cycle, same format as `schedule` (`"90m"`, `"3h"`). Defaults to the schedule interval. Set it whenever the org is scheduled: a cycle that hits this bound is force-stopped with only a 60s drain, so it should exceed how long the work actually takes, not how often you want it to run. Overrunning the interval is safe — the missed tick fires the moment the run ends rather than waiting for the next boundary.
- `mode`: auto | confirm
- `session_id`: session ID passed by command wrapper (snake_case input)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command" (i.e. invoked directly, not by the command wrapper), load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

If `caller` is "command", use the `brain_context` already provided.

Run intake from `mastermind-intake/SKILL.md` if `prompt` is vague (stop at Q3, domain is `ops`). Skip intake if `prompt` is a rich prompt per mastermind-intake/SKILL.md criteria.

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

Persona roles work the same as any other role in v2 — there is no separate `agent_type`/subagent registry to resolve against. Put the character depth directly into `responsibilities` (fed into the agent's role briefing by `buildRolePrompt` in `orgrt/session.ts`, alongside the role's `skills` and `instructions_file`, if set — see Step 2.3): write 3-6 specific, voice-defining responsibilities drawn from the character's known career, positions, and communication style, not generic duties. For a living public figure, base it on documented public behavior — do not invent positions they haven't taken.

**Step 2.2b — Seed each non-persona role from the agent registry.**

The project's agent registry (`.monomind/registry.json`, the `.claude/agents/**` personas) often already describes the job. For every role that is not persona-based, ask for the best-fitting registry agent with the role's title and a one-line summary of its job:

```bash
npx monomind pick -t "<role title>: <one-line summary of what it does>" --agents --top 1 --json \
  | jq -r '.agents.ranked[0] // empty | "\(.id)\t\(.description)"'
# Read that persona's body for concrete duties and practices:
jq -r --arg s "<id from above>" '.agents[] | select(.slug == $s) | .filePath' .monomind/registry.json
```

(If the monomind MCP server in this session exposes an `mcp__monomind__pick` tool, it answers the same question; the CLI works everywhere.) When a hit genuinely fits, read its file and use it to write sharper `responsibilities` for the role — adapted to this org's goal, in your own words, never pasted wholesale; the org config has no field that links to the persona. When nothing is returned or the hit is a poor fit, write the responsibilities from the goal alone.

Write `responsibilities` that tell roles apart: `org_task` with `assignee: "auto"` routes each task to the role whose title and responsibilities match it best (words every role shares count for nothing), so a role whose duties are only boilerplate never gets auto-assigned work.

---

## Step 2.3 — Skills (pick per role from the skill library)

Every role can draw on the **org skill library**: ~380 curated skills (engineering practice, languages and frameworks, design, product, marketing, sales, finance, legal, ops, research) from monomind and MIT/Apache-2.0 open-source repos. For **each** role, search with its title plus its responsibilities (the ones written in Step 2.2b) and choose only from the hits — never invent a skill name, and never use slash-command names such as `mastermind:tasks`, which are not org skills:

```bash
npx monomind org skills search "<role title> <responsibilities>" --limit 8 --format json \
  | jq -r '.skills[] | "\(.name)\t\(.description)"'
npx monomind org skills search "landing page conversion copy" --tag marketing
npx monomind org skills show <name>   # read one before choosing it
```

Give each role two fields:

- **`skills`** — 1–3 skills that define the role, pinned into its system prompt for the whole run (e.g. a backend dev: `["backend-developer", "test-driven-development", "monograph-code-navigation"]`). Keep this short: every pinned skill is prompt text the role pays for on every turn.
- **`skill_pool`** — skills the role may load mid-run with `org_skill_load` when a task calls for one. Only their one-line descriptions sit in the prompt, so this can be wider: names, or `"tag:<tag>"` for a whole tag (e.g. `["systematic-debugging", "tag:security"]`).

Match skills to the work, not to a vague fit: a copywriter gets marketing/writing skills, never code skills. **Tools follow skills automatically** — a skill that declares monomind tools (`monograph_*` for code roles, `monodesign_*` for UI roles) gives its role exactly those tools, so only roles that work on software get the code graph and only UI roles get design tooling. For roles that write or review code, include `monograph-code-navigation` (and `monolean-minimal-change` for implementers); for roles that build or review web UI, include `monodesign-ui-quality`.

At run time each task dispatch names the `skill_pool` skills that fit that task, and a role can look beyond its pool with `org_skill_search` (loading stays limited to its own `skills`/`skill_pool`), so a well-chosen pool matters more than a long pinned list.

`ui.icon` is only the role's picture on the canvas — it has no effect on the prompt. Leave `skills` off when nothing in the library fits cleanly; `responsibilities` alone is a complete role. `org validate` fails on an unknown skill name, so the Step 5 validation is what proves every chosen name is real — fix and re-save until it passes.

---

## Step 2.4 — Per-Role Model and Optional Settings

**`adapter_config.model` — REQUIRED on every role.** Always write an explicit model; never leave a role to inherit a runtime default. A role without one silently moves to whatever model a later release makes the default, and the Step 4 MODELS table can't show what the role will really run on.

- If the user named or clearly implied a model for a role ("the researcher should use Opus" → `"claude-opus-5"`), use it.
- Otherwise set the **latest model for that role's runtime/vendor**:
  - Claude runtime (the default — no `provider`/`runtime`, or `provider.kind` `subscription` / `api-key`): **`"claude-sonnet-5"`** — the org runtime default, `DEFAULT_CLAUDE_MODEL` in `orgrt/vercel-providers.ts`.
  - Any other runtime or vendor: use the value the runtime itself falls back to, read from the installed CLI package rather than from memory — `VENDOR_DEFAULTS[vendor]` (when the role has `provider.vendor`) or the `runtime` switch in `resolveModel()` (`orgrt/session.ts`), and `VERCEL_PROVIDERS[vendor].defaultModel` (`orgrt/vercel-providers.ts`). Source files live under `packages/@monomind/cli/src/orgrt/` in the source repository; in an installed package read `dist/src/orgrt/session.js` and `dist/src/orgrt/vercel-providers.js`. At this release those resolve to:

    | Runtime / vendor | Latest model |
    |------------------|--------------|
    | `claude` (default), vendor `anthropic` | `claude-sonnet-5` |
    | `codex` | `gpt-5.6-terra` |
    | `antigravity` | `gemini-3.6-flash-high` |
    | `kimicode` | `kimi-code/k3` |
    | `opencode` (no vendor) | `glm-5.2` |
    | `vercel` (no vendor), vendor `openai` | `gpt-5.5` |
    | vendor `glm` / `google` / `xai` / `deepseek` | `glm-5.2` / `gemini-3.1-pro` / `grok-4.5` / `deepseek-chat` |

    If the source you read disagrees with this table, the source wins. For vendor `openai-compatible` there is no default (it is `''`) — ask the user for the model id.
- A role may deliberately run a different current model than its runtime's latest when that fits the role (e.g. `claude-opus-5` or `claude-fable-5-1` for a planner, `claude-haiku-4-5-20251001` for a checklist-style reviewer, as the `org create` templates do) — still an explicit value, and still a model from the current family, never a superseded id.

For any role that needs non-default behavior, also set (all optional — omit to inherit defaults):

- `provider`: `{ kind, vendor?, apiKeyEnv?, baseUrl?, authTokenEnv? }` — default `subscription` (local Claude Code login). `kind` is one of:
  - `"subscription"` (default) — Claude Pro/Max via `claude login`
  - `"api-key"` — Anthropic API key
  - `"base-url"` / `"bedrock"` / `"vertex"` / `"gemini"` / `"openai"` — legacy kinds (preserved for backward compat)
  - `"vercel-api-key"` — any API-key provider via the Vercel AI SDK runner; pair with `vendor` (one of `openai`, `anthropic`, `google`, `xai`, `deepseek`, `glm`, `mistral`, `groq`, `together`, `fireworks`, `cohere`, `perplexity`, `alibaba`, `openrouter`, `ollama`, `openai-compatible`). Auto-resolves `runtime: 'vercel'`.
  - `"codex"` — ChatGPT subscription via `codex login` (no env vars needed). Auto-resolves `runtime: 'codex'`.
  - `"antigravity"` — Google AI Pro/Ultra subscription via `agy` CLI (Google OAuth in OS keyring). Auto-resolves `runtime: 'antigravity'`. This is the replacement for the consumer-OAuth path of Gemini CLI (sunset June 18, 2026).
- `runtime`: `"claude"` | `"kimicode"` | `"opencode"` | `"vercel"` | `"codex"` | `"antigravity"` — per-role override of the agent loop backend. Usually unnecessary (auto-resolved from `provider.kind`); set explicitly only when you need to force a specific runner regardless of provider.
- `policy`: `{ allowTools?, denyTools?, fileWrite?, fileRead?, webAllow?, autoApproveTools?, maxTokens? }` — leave the whole object unset for a role that doesn't need it (most roles). But `webAllow` unset/empty means **no web access at all**, and Bash/WebFetch/WebSearch/`org_complete` pause for human approval by default on every call — that's a restriction, not a neutral default, so don't leave it unset for a role whose responsibilities clearly require it (e.g. a role tasked with "gather headlines from news sources" needs `webAllow` populated, not omitted). Set proactively, at creation time, for any role whose stated responsibilities need it:
  - `webAllow: ["*"]` (or specific domains) for a role that does WebSearch/WebFetch as part of its job — an empty/unset `webAllow` silently blocks the exact task you just assigned it.
  - `autoApproveTools: [...]` — tool/action names this role may use without pausing for a human approval, even though they're normally on the sensitive-actions list (`Bash`, `WebFetch`, `WebSearch`, `org_complete`). **Mandatory, not optional, for any org with a `schedule` set** (an unattended/scheduled org): a role that pauses on `WebSearch` or `org_complete` waiting for a human who isn't there to click approve will deadlock forever on every scheduled run, repeatedly re-asking through both `ask_human` and `org_gate` with nothing to show for it. Grant every tool a scheduled org's roles routinely need — including `org_complete` for the boss role — rather than leaving the default human-approval gate in place for automation that's supposed to run with nobody watching.

Apart from `adapter_config.model` (always set, per above), do not invent values for these — only populate `provider`, `runtime`, or `policy` when the user actually specified or clearly implied it, or when a role's responsibilities require it (the `webAllow`/`autoApproveTools` cases above).

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
    "max_turns_per_message": 30,
    "max_run": "<how long ONE scheduled cycle may run, e.g. '90m'. Omit only for a one-shot org (no schedule).>"
  },
  "roles": [
    {
      "id": "<slug>",
      "title": "<display title>",
      "type": "boss | specialist | <domain synonym>",
      "reports_to": "<role id, or null for the single boss>",
      "responsibilities": ["<3-6 specific duties — this text becomes part of the agent's role briefing>"],
      "skills": ["<optional: 1-3 library skills pinned into the briefing — Step 2.3>"],
      "skill_pool": ["<optional: skills or tag:<tag> the role may load mid-run — Step 2.3>"],
      "adapter_config": { "model": "<explicit model from Step 2.4, e.g. claude-sonnet-5>" }
    }
  ]
}
```

`status` starts `"stopped"` regardless of whether `schedule` is set — the org does not run until `monomind org run <name>` (one-shot) or `monomind org serve` (picks up any org whose `schedule` is set) is invoked.

Every role carries `adapter_config.model` (Step 2.4). Only include `provider`, `policy`, or `ui` on a role when Step 2.3/2.4 populated them for it — leave them out entirely rather than writing empty objects.

---

## Step 4 — Show Plan and Confirm (confirm mode)

Render the org plan in a clear human-readable format. **The model assigned to each role is the single most important thing for the user to review here** — give it its own table, not just a line buried inside each role's block, so it can't be skimmed past:

```
╔══════════════════════════════════════════════════╗
║  ORG: <org_name>                                 ║
║  GOAL: <goal>                                    ║
╚══════════════════════════════════════════════════╝

MODELS  ← review this first
────────────────────────────────────────────────────
  ROLE                MODEL
  ──────────────────  ────────────────────────────
  boss                claude-sonnet-5
  content-writer      claude-sonnet-5
  content-reviewer    claude-sonnet-5

  Every role shows the explicit adapter_config.model that will be saved —
  the latest model for its runtime unless you asked for another. To put a
  role on a different model, say so now (e.g. "put content-writer on
  claude-opus-5").

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
Max run: <run_config.max_run, or "schedule interval" when unset>
Memory namespace: org:<org_name>
Schedule: <"every <N> <unit>" if schedule set; otherwise "manual — run with `monomind org run <org_name>`">

Type "go" to accept (including the models above as shown), or describe changes.
```

In **auto** mode, skip this confirmation prompt entirely — but still surface the same MODELS table, non-blocking, appended to the Step 6 save confirmation (see Step 6).

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
#   goal, schedule_val ("" if none), budget_tokens_val, max_run_val ("" if none),
#   roles_json (JSON array matching the role shape above)
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg schedule "${schedule_val:-}" \
  --argjson budget_tokens "${budget_tokens_val:-1000000}" \
  --arg max_run "${max_run_val:-}" \
  --argjson roles "$roles_json" \
  '{name:$name,goal:$goal,status:"stopped",
    schedule:(if $schedule=="" then null else $schedule end),
    run_config:({max_concurrent_agents:4,budget_tokens:$budget_tokens,
                 memory_namespace:("org:"+$name),max_turns_per_message:30}
                + (if $max_run=="" then {} else {max_run:$max_run} end)),
    roles:$roles}' \
  > "${orgJson}.tmp" && mv "${orgJson}.tmp" "$orgJson"
```

**POST-SAVE VALIDATION (run immediately after saving — abort if it fails):**

```bash
# Parses with OrgDefSchema (the exact code path org run/serve use) and checks the
# structural invariants: exactly one root role, every reports_to resolves, unique
# role ids, parseable schedule, name/filename agreement.
if npx -y monomind@latest org validate "$org_name"; then
  echo "✓ Org config validated — ready for: monomind org run ${org_name}"
else
  # CLI < 2.1.8 has no `org validate` — fall back to the two structural checks:
  root_count=$(jq '[.roles[] | select(.reports_to == null)] | length' "$orgJson")
  bad_reports=$(jq -r '([.roles[].id]) as $ids |
    [.roles[] | select(.reports_to != null and (.reports_to as $r | $ids | index($r) | not)) | .id] | join(", ")' "$orgJson")
  if [ "$root_count" -ne 1 ] || [ -n "$bad_reports" ]; then
    echo "ERROR: org config invalid (roots: $root_count, unresolved reports_to: ${bad_reports:-none}) — fix the roles array and re-save."
    exit 1
  fi
  echo "✓ Structural checks passed (upgrade monomind for full schema validation)"
fi

# Every agent role must pin its model explicitly (Step 2.4).
missing_model=$(jq -r '[.roles[] | select(.kind != "endpoint" and ((.adapter_config.model // "") == "")) | .id] | join(", ")' "$orgJson")
if [ -n "$missing_model" ]; then
  echo "ERROR: roles without an explicit adapter_config.model: ${missing_model} — set the latest model for their runtime (Step 2.4) and re-save."
  exit 1
fi
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
  - "Run `monomind org run <org_name>` to start the organization in the foreground (add --dry-run to preview each role's briefing first)"
  - "After hand-editing the config, re-check it with `monomind org validate <org_name>`"
  - "While running: `monomind org logs <org_name> --follow`; afterwards: `monomind org report <org_name>` for outcome, per-role activity, and token usage"
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

In **auto** mode (where Step 4's plan/model confirmation was skipped), always also print the models table so the user still sees — after the fact — what each role will run on, even though nothing blocked on it:
```
  Models:
    boss                claude-sonnet-5
    content-writer      claude-sonnet-5
    content-reviewer    claude-sonnet-5
  Adjust with: /mastermind:org-settings, or edit .monomind/orgs/<org_name>.json directly
```
In **confirm** mode this table was already shown and accepted in Step 4 — do not repeat it here.

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
