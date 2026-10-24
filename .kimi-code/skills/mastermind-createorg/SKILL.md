---
name: mastermind-createorg
description: "Mastermind createorg — design an autonomous agent org and save it as `.monomind/orgs/<name>.json` for `monomind org run/serve`; --schedule for daemon-scheduled orgs."
type: domain-skill
default_mode: confirm
---

# Mastermind Create Org

This skill is invoked by `mastermind:createorg` or directly via `/mastermind:createorg`.

The Org Runtime (`packages/@monomind/cli/src/orgrt/`) is a Node daemon, not a Task-tool-spawned boss agent. Every role in the config becomes a live SDK agent session (`@anthropic-ai/claude-agent-sdk` `query()`) the moment the org starts — there is no task board, no per-role generated `.claude/agents/*.md` file, and no communication-topology array. Roles address each other directly with the `org_send` tool using their `id` (or `<org>:<id>` cross-org). This skill's only job is to produce a config that validates against `OrgDefSchema` (`packages/@monomind/cli/src/orgrt/types.ts`), with a structure that fits the work (Step 1b).

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `prompt`: goal and/or role description for this org
- `org_name`: desired name for the org (slug, e.g. `content-team`); constrained to `[a-z0-9-]`
- `roles_desc`: optional explicit role list from user (e.g. "boss, content writer, reviewer, marketer, designer")
- `schedule`: optional schedule string in daemon format — `"<N>s"`, `"<N>m"`, or `"<N>h"` (e.g. `"30m"`, `"2h"`). When provided, the org is picked up by `monomind org serve` on its own interval; omit for a one-shot `monomind org run`.
- `max_run`: optional, same format as `schedule`. See the run_config note below — always set it for a scheduled org.
- `budget_tokens`: optional total token budget for the org run (default 1,000,000 × the number of roles — the daemon splits it evenly across roles, and a role that browses or re-reads large files needs about 1M of its own; `org validate` #23 flags less)
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

## Step 1b — Choose the structure (before deriving roles)

Pick the structure from the work, then derive roles for it. The evidence below is harness-only and exploratory (one to three trials per cell, Sonnet 5.5, mechanical code-reading fixtures, harness dollars): it argues for a default and for a burden of proof, it is not a guarantee. Say so when you cite it.

| The work | Structure | Measured reason |
|---|---|---|
| Small, or a sequential stream one capable agent can hold (a content calendar, a research note, a feature with a few steps) | **A single agent session. Do not create an org.** If the user still wants an org, make it one boss and one worker, no review layer | Growth-like: the single role cleared the same bar (27 of 27) at 3.5x to 5.5x lower cost. Eight independent modules with no binding deadline: one agent matched the teams at about a quarter of the cost. Revise fixture: one agent at about 30% of the role arms' cost. Nothing measured has beaten one agent where the deadline did not bind |
| Many independent parts and a **deadline the single agent's serial time exceeds** | **A parallel team**: one boss and one worker per stream, each worker writing only its own files, plus a synthesiser when results must be combined. Set `run_config.max_run` and `max_concurrent_agents` to the roster size | 32 independent sheets in 600 s: the team finished 33 of 33 in 297 s, the single agent 29 of 33 in 596 s, at 3.8x to 4.8x the cost; a team without the deadline cost that multiple for nothing. Estimate the serial time first: setup about 190 s plus 14 to 30 s per part in that fixture |
| **Correctness of the hand-offs matters** (a wrong value in one worker's output reaches the combined result and nobody downstream re-derives it) | **Sections with typed documents**: a contract per hand-off with per-answer evidence and `checks`, the runtime notifying each declared consumer on every publish (and the producer on a rejection), the consumer running `org_doc_check` before it decides, a bounded rework loop | With per-answer evidence, `doc_check` and the publish notice, a consumer caught 8 of 8 injected inconsistencies (including the wrong values that 0 of 4 caught before) and producers republished 12 of 12 times; without the notice an idle consumer read nothing and 230 s of the deadline were lost. It cost $2 to $8 more per trial, used up deadline margin, and 4 natural errors that agreed with their own evidence passed unflagged |

**Sections are generally available.** A `sections:` org starts like any other org; `run_config.experimental: "eval"` is no longer needed (an org that still declares it keeps the harness-only start). Use them for the third row, when the hand-offs between stages need a typed, accepted, rework-capped channel. What they give: documents as the only channel between sections (`org_doc_publish`, `org_doc_read`, `org_doc_decide`), a read path the runtime enforces (a role reads only the documents it may, so a seat cannot see another seat's scorecard), schema-validated hand-offs, accept or reject by the consuming section's lead with a capped rework loop (`max_rework_rounds`), and ordering by construction (a consumer cannot read a document that is not accepted, and the run cannot complete while one is pending). What they do not give, as built: `evidence.verify` is `cited` only (`fetch` and `rerun` are not yet supported), and a contract's `checks` are a small dialect for answer-sheet documents (integer values, evidence chains), so they cannot verify claims or scores. `org validate` #21 therefore fires only for a document whose schema has a `sheets` property; give such a document `checks`, and leave `checks` off every other document. What the validator enforces: every non-root role belongs to exactly one section and reports to its section's lead; every published type is consumed by some section; `run_config.budget_usd` and `sections.<n>.budget` are not supported when a role runs on an unpriced runtime (codex, antigravity), so such an org keeps token budgets; and a runtime needs a sections isolation entry (`kilo` is refused, ten runtimes including claude, codex and antigravity are verified; see `doc/concepts/org-runtime.md`, 6.7). Sections add overhead (measured $2 to $8 more per trial), so adding roles never justifies them by themselves; propose them only for a pipeline whose stages hand typed work to each other.

Rules that follow from the results:
- Recommend a team only with a stated deadline and independent parts. Otherwise recommend the single agent and say why in one line. Adding roles never justifies sections by itself.
- State what the evidence does not cover: natural errors that agree with their own evidence were not caught by any check; one trial per arm; the injected faults were detectable by construction.
- An explicit `roles_desc` from the user stays authoritative (Step 2). Still tell them, in the plan, which row applies and what the checklist warns (items 19 to 21 of `org validate`: a chain of roles, a parallel team with no deadline, a document type with no checks). Warnings are advice; never block on them.

## Step 1c — Roster budget (before listing roles)

Every role is a live session that pays its own startup context, and the boss spends turns briefing each one, so roles are the main cost of an org. Derive the smallest roster that does the work:

- **A flat org (no sections) holds at most 4 roles**, the boss included. Past 4, organise the roles into sections.
- **A sections org holds at most 10 sections, and a section at most 4 roles (lead included). Default to 3 roles per section.** Choose the optimal grouping, not the largest or the smallest: every section boundary adds a typed hand-off, so put adjacent stages that share a skill set or whose output the next stage would accept as a matter of course into one section of 2 to 4 roles. Give a stage its own section, even a one-role one, only when its output must be accepted before the next stage starts (an independent check, a gate, a deploy). A pipeline of many one-role sections is usually a sign of over-splitting: count the hand-offs that truly need an accept step and make that many sections.
- **Merge before adding.** A reviewer is the executor's own checklist step unless review must be independent of the author. Two roles with overlapping skills become one. One role per tool or per file type is a sign of over-splitting.
- Say in the Step 4 plan how many roles you cut or merged and why, and never exceed a user's explicit `roles_desc` (Step 2). `org validate` #25 warns on a flat org above 4 roles, more than 10 sections, or a section above 4 roles.

---

## Step 2 — Ingest Roles

Parse `roles_desc` (if provided) into a list of role titles. If not provided, derive a set of roles from `prompt` by identifying the human functions needed to achieve the goal.

**Required roles to include when deriving roles from the prompt** (**skip this rule for persona-based orgs**, see below, where the characters themselves define the structure):
- A coordinator/boss role that owns the goal — exactly one role with `reports_to: null`; its `responsibilities` must say it sends self-contained task briefs (a worker resumed from a task session knows nothing else; `org validate` #8)
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

Persona roles work the same as any other role — there is no separate `agent_type`/subagent registry to resolve against. Put the character depth directly into `responsibilities` (fed into the agent's role briefing by `buildRolePrompt` in `orgrt/session.ts`, alongside the role's `skills` and `instructions_file`, if set — see Step 2.3): write 3-6 specific, voice-defining responsibilities drawn from the character's known career, positions, and communication style, not generic duties. For a living public figure, base it on documented public behavior — do not invent positions they haven't taken.

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

**Models are the newest of their family, resolved when the org runs — do not pin them.** Leave `adapter_config.model` out: a role then runs the newest default for its runtime (Sonnet on claude, Terra on codex, Flash on antigravity; `latest-models.ts`) at medium effort, and it never runs an older model than exists. A pin goes stale, and `org validate` warns when a pinned model is older than the newest in its family. Pin a model only when the user names an exact one. The Step 4 plan shows what each role will resolve to, the same as the role headers of `monomind org run <org> --dry-run`.

- If the user named an exact model for a role ("pin the researcher to claude-opus-5-5"), pin it. If the user only named a family ("the researcher should use Opus"), do not pin: assign the built-in `standard` tier so the role follows the newest Opus: `"cost_tiers": {"roles": {"<role id>": {"tier": "standard", "effort": "medium"}}}` (built-in tiers: `standard` = newest Opus, `economy` = newest Sonnet, `budget` = newest Haiku).
- Otherwise write no model. For reference, this is what an unpinned role resolves to (the runtime computes it; you do not write it):
  - Claude runtime (the default — no `provider`/`runtime`, or `provider.kind` `subscription` / `api-key`): **`"claude-sonnet-5-5"`** — the newest Sonnet, the org runtime default (`defaultClaudeModel()` in `orgrt/vercel-providers.ts`, resolved by `latest-models.ts`).
  - Any other runtime or vendor: use the value the runtime itself falls back to, read from the installed CLI package rather than from memory — `VENDOR_DEFAULTS[vendor]` (when the role has `provider.vendor`) or the `runtime` switch in `resolveModel()` (`orgrt/session.ts`), and `VERCEL_PROVIDERS[vendor].defaultModel` (`orgrt/vercel-providers.ts`). Source files live under `packages/@monomind/cli/src/orgrt/` in the source repository; in an installed package read `dist/src/orgrt/session.js` and `dist/src/orgrt/vercel-providers.js`. At this release those resolve to:

    | Runtime / vendor | Latest model |
    |------------------|--------------|
    | `claude` (default), vendor `anthropic` | `claude-sonnet-5-5` |
    | `codex` | `gpt-5.6-terra` |
    | `antigravity` | `gemini-3.8-flash-high` |
    | `kimicode` | `kimi-code/k3` |
    | `opencode` (no vendor) | `glm-5.2` |
    | `vercel` (no vendor), vendor `openai` | `gpt-5.5` |
    | vendor `glm` / `google` / `xai` / `deepseek` | `glm-5.2` / `gemini-3.1-pro` / `grok-4.5` / `deepseek-chat` |

    This table is the floor, not the answer: the runtime resolves the newest model of each family when it runs (`monomind agent models <runtime>` lists what a runtime offers right now), and a model is never older than the newest known one. `org validate` warns about a pin older than the newest in its family. If the source you read disagrees with this table, the source wins. For vendor `openai-compatible` there is no default (it is `''`) — ask the user for the model id.
- A role may run a different model than its runtime's default when that fits the role (an Opus planner, a Haiku checklist reviewer): use the built-in tiers above so it stays the newest of its family. Claude Fable and GPT Astra models are never assigned or routed: `org validate` and `org run` reject any role or cost tier that names one, so never choose one, even as "the most capable".

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
  - `fileWrite`/`fileRead` entries: a plain path with no glob characters (`*`, `?`, `[`, `{`), e.g. `"{{org_root}}/site"` (placeholders expand first) or `"reports"`, grants that directory **and everything beneath it**; an entry with glob characters matches only what the glob says. Relative entries resolve against the org workdir.
  - `webAllow: ["*"]` (or specific domains) for a role that does WebSearch/WebFetch as part of its job — an empty/unset `webAllow` silently blocks the exact task you just assigned it.
  - `fileRead`/`fileWrite` must list every file the role reads or writes, including files other roles write for it (a scorer that reads `red-team.md` needs that file listed, and a role that must re-read its own output folder needs the folder). The runtime already lets a role read its own saved tool results and its own mail digests; nothing else outside the list.
  - `denyTools: ["Agent", "Task"]` on any role that must not launch subagents or choose models for them (an org whose seats are pinned to vendors needs this on the lead). A denied tool is not listed in the role's briefing, so say in its responsibilities which common tools it lacks ("Bash is not available; use Read and Write"), or it tries them first and is refused.
  - `antigravity` has no OS sandbox, and `codex`'s own sandbox confines writes to the working directory (plus the safe `policy.sandbox.allowWrite` directories) but does not restrict reads, and cannot deny a path inside a writable directory: `fileRead`/`fileWrite` on those roles are a request to the model, not enforced (`org validate` #24). Do not rely on them to keep a scorer blind or out of a folder; say in the role's responsibilities what it must not read, and keep what must stay hidden out of its brief.
  - `autoApproveTools: [...]` — tool/action names this role may use without pausing for a human approval, even though they're normally on the sensitive-actions list (`Bash`, `WebFetch`, `WebSearch`, `org_complete`). **For each role, either list or deny each of `Bash`, `WebFetch` and `WebSearch`**: list the ones its duties use, and put the rest in `policy.denyTools` (`org validate` #5 fires on any of the three left neither listed nor denied, for all roles of an unscheduled org too) (`org validate` #5 fires for an unscheduled org too, and nobody is there to answer a one-shot run either). **Mandatory without exception for any org with a `schedule` set** (an unattended/scheduled org): a role that pauses on `WebSearch` or `org_complete` waiting for a human who isn't there to click approve will deadlock forever on every scheduled run, repeatedly re-asking through both `ask_human` and `org_gate` with nothing to show for it. Grant every tool a scheduled org's roles routinely need — including `org_complete` for the boss role — rather than leaving the default human-approval gate in place for automation that's supposed to run with nobody watching.

Do not invent values for these — only populate `provider`, `runtime`, or `policy` when the user actually specified or clearly implied it, or when a role's responsibilities require it (the `webAllow`/`autoApproveTools` cases above).

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
    "max_concurrent_agents": "<number of roles — an idle worker keeps its slot>",
    "budget_tokens": "<budget_tokens input, or 1000000 × the number of roles>",
    "memory_namespace": "org:<org_name>",
    "max_turns_per_message": 80,
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
      "skill_pool": ["<optional: skills or tag:<tag> the role may load mid-run — Step 2.3>"]
    }
  ]
}
```

**Sections shape (when Step 1c leaves more than 4 roles).** Every non-root role belongs to exactly one section and reports to that section's lead; the root belongs to none. Add `"requires": {"sections": 1}` and `"run_config.completion": {"mode": "boss"}`, then:

```json
"sections": {
  "build":  { "lead": "builder", "members": ["builder", "fixer"], "publishes": ["build-record"], "max_rework_rounds": 2 },
  "verify": { "lead": "qa", "members": ["qa"], "consumes": ["build-record"], "publishes": ["qa-record"], "max_rework_rounds": 2 }
},
"documents": {
  "build-record": { "schema": { "type": "object", "required": ["status"], "properties": { "status": { "enum": ["PASS", "FAIL"] } } }, "evidence": [{ "kind": "command", "min": 1 }], "visibility": "org", "max_publish_attempts": 5 }
}
```

Each published type needs a `documents` entry, a producer and a consumer. The last section of a pipeline publishes nothing: the boss, which is in no section, closes the run after it (`org validate` warns about a type no section consumes). A single-member section leads itself. `/doc/concepts/org-runtime.md` section 6.7 has the full contract. Sections are the way to go past 4 roles; make each one a stage with a real typed hand-off, and merge roles that do not need one.

**Efficiency defaults (every org).** Put routine workers on the cheap tier and keep the boss and any role that judges others on the default model: `"cost_tiers": {"roles": {"<worker id>": {"tier": "economy", "effort": "low"}, "<boss or judge id>": "exempt"}}`. Set `"session_scope": "task"` in `run_config` for workers that take independent tasks (a worker resumed per task does not carry a growing transcript), and `max_concurrent_agents` to the number of roles (an idle role keeps its slot; `org validate` #3 and the sections check reject less). Keep `budget_tokens` at the default of 1M per role: a smaller total draws #23, and the savings come from the cheap tiers, not from a tight budget. `org validate` #4 (no `budget_usd`) is advice for a Claude-only org: leave it unless the user asks for a USD ceiling, and never add `budget_usd` to a codex or antigravity role.

`status` starts `"stopped"` regardless of whether `schedule` is set — the org does not run until `monomind org run <name>` (one-shot) or `monomind org serve` (picks up any org whose `schedule` is set) is invoked.

Only include `adapter_config` (a pinned model the user named), `provider`, `policy`, or `ui` on a role when Step 2.3/2.4 populated them for it — leave them out entirely rather than writing empty objects.

Leave `run_config.completion_evidence` out unless the org's roles commit code: it makes `org_task_done` demand a commit sha, which a role with no Bash cannot produce, so every task of a research org is refused and the lead has to cancel them by hand (`org validate` #22). Do not copy it from a code org such as `release`.

When the org's roles do not commit, tell them how to close a task: in the lead's brief rule (or the role's responsibilities), "close with `org_task_done { taskId, result }` and no `evidence`". A Codex role otherwise attaches its own evidence shape, the strict `evidence` schema (headSha only) refuses the first close, and every task costs an extra turn.

**Order a pipeline with dependencies, not with the lead's memory.** A phase that needs an artifact another step produces (a debate relay, a dossier, a rubric) must be a task that the later tasks `depends_on`, or the later tasks must be created only after the file exists. A responsibility such as "write the relay before dispatching round 2" is not enough: in the reputation-panel debate round the lead created all three round-2 tasks first and wrote the relay afterwards, so the scorers rescored without it and had to be re-asked.

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
  boss                claude-sonnet-5-5 · medium
  content-writer      claude-sonnet-5-5 · medium
  content-reviewer    claude-sonnet-5-5 · medium

  Every role shows the model and effort it will resolve to when it runs —
  the newest of its family at medium effort unless you asked for another.
  To put a role on a different model, say so now (e.g. "put content-writer
  on the newest Opus"; that becomes the built-in `standard` tier).

STRUCTURE  (Step 1b)
────────────────────────────────────────────────────
  Row chosen: <single agent | parallel team (deadline: <x>) | hand-off review (no-section alternative)>
  Why: <one line from the measured table>   Not covered: <what the evidence does not show>

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
# Set shell variables from the confirmed plan before running this block
# (extra_json: top-level keys beyond these, e.g. sections, documents, requires, cost_tiers —
#  a "run_config" object here is merged into the one below, so session_scope and completion go in it).
extra_json=${extra_json:-'{}'}
# Other variables:
#   goal, schedule_val ("" if none), budget_tokens_val, max_run_val ("" if none),
#   roles_json (JSON array matching the role shape above)
jq -n \
  --arg name "$org_name" \
  --arg goal "$goal" \
  --arg schedule "${schedule_val:-}" \
  --argjson budget_tokens "${budget_tokens_val:-$(( $(jq length <<<"$roles_json") * 1000000 ))}" \
  --arg max_run "${max_run_val:-}" \
  --argjson roles "$roles_json" \
  --argjson extra "$extra_json" \
  '{name:$name,goal:$goal,status:"stopped",
    schedule:(if $schedule=="" then null else $schedule end),
    run_config:({max_concurrent_agents:($roles|length),budget_tokens:$budget_tokens,
                 memory_namespace:("org:"+$name),max_turns_per_message:80}
                + (if $max_run=="" then {} else {max_run:$max_run} end)),
    roles:$roles} * $extra' \
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

# Review for signing (#502): the runtime refuses to start or reload an org
# definition the operator has not signed. Without a terminal this prints the
# full review (each role's runtime, access level, tools, skills,
# instructions_file and sandbox, the org's prechecks, and any role that would
# run unconfined) and signs nothing. It exits non-zero by design.
npx -y monomind@latest org sign "$org_name" || true
```

Show the user that review verbatim, then tell them to sign the org themselves in their own terminal after reading it: `monomind org sign <org_name>`. Do not sign it for them (never pass `--yes`): the signature is the operator's approval of what the roles may do.

After any later edit to a role's `policy`, `skills`, `instructions_file`, the roles, runtimes, `schedule` or `run_config`, the org must be signed again (`monomind org sign <org_name>`) before `org run`, `org reload` or `org serve` will use the change.

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
  - "Edit .monomind/orgs/<org_name>.json directly, or use /mastermind-org-settings, to change goal/budget/roles"
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
  Adjust with: /mastermind-org-settings, or edit .monomind/orgs/<org_name>.json directly
```
In **confirm** mode this table was already shown and accepted in Step 4 — do not repeat it here.

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
