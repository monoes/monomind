# Agents & Skills

> Where monomind's agents, skills, slash commands and Org skills live, how to add your own, and how to check that they get picked. How the picker chooses between them is covered in [Routing](./routing.md).

Monomind works with four kinds of reusable instructions:

| Kind | What it is | Who runs it |
|---|---|---|
| **Agent** | A subagent definition: one Markdown file with frontmatter and a system prompt | Claude Code's Task tool (`subagent_type` = the agent's `name`) |
| **Skill** | A `SKILL.md` directory Claude Code loads as a skill | Claude, via `Skill("<name>")` |
| **Slash command** | A Markdown prompt under `.claude/commands` | You or Claude, as `/<group>:<name>` |
| **Org skill** | A `SKILL.md` directory in the Org skill library | Org runtime roles (`skills`, `skill_pool`, `org_skill_load`), or anyone through `org skills show` / the `org_skill_show` MCP tool |

The npm package ships <!-- doc-count:bundled-agents -->88<!-- /doc-count:bundled-agents --> agent definitions (<!-- doc-count:pickable-agents -->84<!-- /doc-count:pickable-agents --> pickable; the rest are deprecated and stay spawnable by name), <!-- doc-count:bundled-skills -->88<!-- /doc-count:bundled-skills --> skills (<!-- doc-count:pickable-skills -->83<!-- /doc-count:pickable-skills --> pickable; the rest are helper pieces other skills include), <!-- doc-count:slash-commands -->115<!-- /doc-count:slash-commands --> slash commands and <!-- doc-count:org-skills -->376<!-- /doc-count:org-skills --> Org skills. `monomind init` copies the agent categories, skills and command groups the selected components include into your project; files you add beside them are left alone.

Every agent, skill, command and Org skill ends up in one index that the central picker ranks for each task — the `[PICK]` line in Claude's context, `monomind pick` and the `pick` MCP tool. See [How picking works](#how-picking-works) below and [Routing](./routing.md) for the details.

---

## 1. Where things live

### Agents

| Location | Origin | Notes |
|---|---|---|
| `.claude/agents/<category>/<name>.md` | project | Any depth. `schemas/`, `ephemeral/` and `reengineer-squad/` are skipped |
| `$MONOMIND_EXTRA_AGENT_PATHS` (colon-separated) | extra | Scanned before `.claude/agents` and win a slug clash |
| `../agency-agents` (sibling of the project) | extra | Used only when `MONOMIND_EXTRA_AGENT_PATHS` is unset |
| `~/.claude/agents/**/*.md` | user | Your agents for every project; a project agent of the same name wins — see [User-level agents](#user-level-agents) |
| `packages/@monomind/cli/.claude/agents` | shipped | The originals `monomind init` copies into `.claude/agents` |

The picker reads the index `.monomind/registry.json` ([`registry-builder.ts → buildUnifiedRegistry`](packages/@monomind/cli/src/agents/registry-builder.ts#buildUnifiedRegistry)). It belongs to the project root — the nearest directory at or above the current one that holds `.claude/agents` or `.monomind`, never above the git root or at `$HOME`. It is rebuilt when it is missing or older than any agent file in any root, user agents included ([`registry-freshness.ts → ensureRegistry`](packages/@monomind/cli/src/agents/registry-freshness.ts#ensureRegistry)): always by `monomind init` and `init upgrade`, at every Claude Code session start, by any `monomind` command run in the project (the MCP server Claude Code starts included), and synchronously before `monomind pick` and the `pick` MCP tool rank. The prompt hook reads the file as the session start left it. A build that finds no agents never replaces a registry that has some. Duplicate slugs keep the first file found and are reported by `monomind doctor -c registry`; a user agent hidden by a project agent of the same name is listed as shadowed.

### Skills and slash commands

| Location | Origin | Invoked as |
|---|---|---|
| `.claude/skills/<name>/SKILL.md` | project | `Skill("<name>")` |
| `~/.claude/skills/<name>/SKILL.md` | user | `Skill("<name>")` — indexed only for names the project lacks |
| `.claude/commands/<name>.md` | project | `/<name>` |
| `.claude/commands/<group>/<name>.md` | project | `/<group>:<name>` (deeper nesting adds more `:` segments) |

Claude Code loads skills and commands itself; monomind adds them to the pick index, `.claude/helpers/skill-registry.json`, written by [`build-skill-registry.cjs → build`](.claude/helpers/build-skill-registry.cjs#build). The index is generated per machine — by `monomind init`, `monomind init upgrade`, `monomind pick` and the SessionStart hook whenever a source is newer — and is gitignored, never shipped. It leaves out:

- `README`, `overview` and `reference(s)` pages, and anything under a `references/` directory;
- files and directories whose name starts with `_` (shared includes such as `_repeat.md`);
- helper-only skills — the built-in protocol pieces (`mastermind-protocol`, `mastermind-intake`, …) and any file with `type: helper`;
- files with `user-invocable: false`.

`monomind init` also installs skills for the other coding systems it sets up (for example `.agents/skills` and `.gemini/skills`); only `.claude/skills` feeds the pick index.

### Org skills

| Location | Origin | Order |
|---|---|---|
| `.monomind/org-skills/<name>/SKILL.md` | project | 1 — overrides the same name below |
| `~/.monomind/org-skills/<name>/SKILL.md` (`$MONOMIND_HOME/org-skills`) | user | 2 |
| `packages/@monomind/cli/org-skills/<name>/SKILL.md` | bundled | 3 — the shipped library, tag vocabulary in [`TAGS.md`](packages/@monomind/cli/org-skills/TAGS.md) |
| `.monomind/catalog/` | catalog | Active catalog skills that target `org`, after the roots (before them when approved with `replacesLegacy`) — see [Skill Catalog](./catalog.md) |

Names must match `^[a-z0-9][a-z0-9-]{0,63}$` ([`skill-library.ts`](packages/@monomind/cli/src/orgrt/skill-library.ts#SKILL_NAME_RE)). Extra `.md` files beside `SKILL.md` are reference files a role can load one at a time. Read any Org skill with `monomind org skills show <name>` or the `org_skill_show` MCP tool; Org skills also appear in the pick index (`orgSkills`) unless a platform skill, a known alias of one, or an agent already has the name.

Inside an org, a role gets skills in three ways ([Org Runtime § 6.6](./org-runtime.md)): `skills` (full text pinned into its prompt), `skill_pool` (names or `tag:<tag>` selectors; only one-line descriptions sit in the prompt, the role loads the text with `org_skill_load`) and `org_skill_search` (search the whole library; loading stays limited to the role's own pool).

---

## 2. Adding an agent

1. Create `.claude/agents/<category>/<slug>.md` (or `~/.claude/agents/<slug>.md` for every project):

   ```markdown
   ---
   name: API Contract Reviewer
   description: Reviews REST and GraphQL contracts for breaking changes, versioning and consistent error shapes before they ship.
   when_to_use: Use when an API schema or endpoint signature changes and needs a compatibility review; not for implementation work
   tags: [api, review, compatibility, graphql]
   category: engineering
   ---

   You are an API contract reviewer. ...
   ```

2. Check it is indexed and ranks for the tasks you wrote it for:

   ```bash
   monomind pick -t "review the new orders endpoint for breaking changes" --agents
   monomind pick -t "..." --agents --explain   # score breakdown and pick history
   monomind doctor -c pick                     # agent count, duplicates, staleness
   ```

3. Spawn it by its `name`: `Task({ subagent_type: "API Contract Reviewer", ... })` or `monomind agent spawn --type "API Contract Reviewer"`.

### Agent frontmatter

| Field | Expected | Meaning |
|---|---|---|
| `name` | yes | The spawnable name — Claude Code's Task `subagent_type`, and what every pick returns. Defaults to the slug |
| `description` | yes | What the agent does, in at most 160 characters. The decision model receives `when_to_use — description` cut at 160 characters, so `when_to_use` matters most |
| `when_to_use` | yes | One line, ≤160 characters, starting "Use when…"; say what it is *not* for. The picker leads the agent's text with it |
| `tags` | yes | A few lowercase keywords; ranked as extra text |
| `category` | yes | One of `core`, `architecture`, `engineering`, `testing`, `security`, `devops`, `github`, `marketing`, `design`, `coordination`, `data-ai`, `specialized`. Without it, the first directory under the agents root is used (`default` for a file at the top level). `monomind pick --categories` filters on it |
| `slug` | no | Registry id; defaults to the file name, lowercased, spaces to `-` |
| `deprecated` / `deprecatedBy` | no | `deprecated: true` drops the agent from ranking but keeps it spawnable; `deprecatedBy` names the replacement |
| `capability.expertise`, `capability.task_types`, `vibe` | no | Ranked as extra text |
| `tools`, `version`, `dependencies`, `triggers` | no | Stored in the registry; not used for ranking. Other fields (`color`, `emoji`, …) are ignored by the index |

All bundled agents follow these rules; a project's own agents are indexed either way, but an agent without `when_to_use` ranks on its description alone (`monomind doctor` counts agents missing it, and `monomind init upgrade` refreshes unedited bundled agents that predate it).

### User-level agents

Agents in `~/.claude/agents/**` are indexed for every project with origin `user`. A project agent with the same name wins. `monomind init` and `monomind init upgrade` build both indexes and print their counts, user-level agents included. `monomind pick` sees them from any directory, including one that is not a project. A new user agent is routed by the prompt hook from the next session start, without running the CLI. Like every candidate, their names and short descriptions are sent to the decision model only when one is configured ([privacy](../privacy.md)).

---

## 3. Adding a skill or slash command

A **skill** is a directory:

```markdown
<!-- .claude/skills/release-notes/SKILL.md -->
---
name: release-notes
description: Use when drafting release notes from merged PRs and the changelog. Groups changes by audience and flags breaking changes.
---

# Release notes
...
```

A **slash command** is a single file — `.claude/commands/release/notes.md` becomes `/release:notes`. Frontmatter is optional for commands: without a `description`, the index uses a leading `<!-- … -->` comment, then the first `# Heading`.

| Field | Meaning |
|---|---|
| `name` | Display name; the directory (skills) or path (commands) is what is invoked |
| `description` | What it does and when to use it. Put the trigger in the first sentence — the decision model sees the first 160 characters, and the keyword ranker weighs rare words in it |
| `pick: low` | Admin or meta entry: it keeps 35 % of its keyword score, so it surfaces only when the task names it (org-management pages, the picker itself) |
| `type: helper` | Never an entry — for pieces other skills include |
| `user-invocable: false` | Never an entry |

Check it:

```bash
monomind pick -t "write release notes for 2.17" --skills   # rebuilds the index if stale
node .claude/helpers/build-skill-registry.cjs              # rebuild by hand; prints counts
monomind doctor -c pick                                     # index freshness and counts
```

For the structure of a good skill body, `Skill("skill-builder")` walks through it. Imported third-party skills can go through the [Skill Catalog](./catalog.md) instead, which gates what reaches the picker.

---

## 4. Adding an Org skill

```markdown
<!-- .monomind/org-skills/incident-postmortem/SKILL.md -->
---
name: incident-postmortem
description: "Use when writing a blameless postmortem after an incident: timeline, contributing factors, and follow-up actions with owners."
tags: [operations, writing, incident-response]
tools: []
license: MIT
---

# Incident postmortem
...
```

| Field | Meaning |
|---|---|
| `name` | Must equal the directory name (`a-z`, `0-9`, `-`, up to 64 characters) |
| `description` | Starts "Use when…"; roles see it in their on-demand list and `org_skill_search`, cut at 200 characters |
| `tags` | 3-5 tags from [`TAGS.md`](packages/@monomind/cli/org-skills/TAGS.md) (required for bundled skills). A tag hit ranks like a name hit, and `skill_pool: ["tag:<t>"]` selects by tag |
| `tools` | monomind MCP tools the skill benefits from (`monograph_*`, `monodesign_*`); a role holding the skill gets exactly those |
| `license` | Required for imported skills; `org skills import` accepts only MIT and Apache-2.0 |
| `source`, `source_path`, `source_commit` | Provenance, written by `org skills import` |

Put it in `.monomind/org-skills` (this project), `~/.monomind/org-skills` (every project) or import a repository's skills with `monomind org skills import <owner/repo> [--global]`. Check it:

```bash
monomind org skills show incident-postmortem
monomind org skills search "blameless postmortem" --tag operations
monomind org validate <org>          # fails on unknown names in skills / skill_pool
```

Commands are in [`org skills`](../commands/org.md#org-skills--the-org-skill-library).

---

## 5. How picking works

One central picker ranks everything above for a task ([Routing](./routing.md) is the full account):

1. **One index.** Agents from `.monomind/registry.json`, skills and commands from `.claude/helpers/skill-registry.json` (platform, user and Org skills), loaded by [`jev-catalog.cjs`](.claude/helpers/jev-catalog.cjs) for both the hooks and the CLI.
2. **Ranking.** When a Jev decision model is configured (`MONOMIND_JEV_URL`, or `TYPESAFE_API_KEY` with `MONOMIND_JEV_HOSTED=1`), it chooses from a keyword shortlist of up to 30 candidates per list; it is off by default. Otherwise — or when its answer is below the confidence floor, times out or fails — the BM25-style keyword ranker [`pick-rank.cjs`](.claude/helpers/pick-rank.cjs) decides. What the model receives is listed in [privacy](../privacy.md).
3. **Delivery.** The `UserPromptSubmit` hook prints `[PICK] agent: <name> · skill: <invoke>` into Claude's context when the answer is confident; `monomind pick`, the `pick` MCP tool, `hooks_route`, `route task`, `guidance_recommend` and the mastermind workflows ask the same picker on demand.
4. **Learning.** Whether spawned subagents followed the pick and succeeded is logged, and re-ranks near-tied keyword picks within ±15 %.

So the text you write *is* the routing: `when_to_use`, `description` and `tags` are what the ranker matches and what the decision model reads. Write the words a person would use to ask for the task.

---

## 6. Contributing to monomind itself

In this repository the npm-shipped tree `packages/@monomind/cli/.claude/` is the source `monomind init` copies from; the root `.claude/` is the copy the repository itself uses. `node scripts/sync-claude-trees.mjs` (`pnpm run sync:claude-trees`) makes every file present in both trees identical to the root copy; it never creates or deletes a file.

- **New agent, skill or command:** add it to `packages/@monomind/cli/.claude/…` (and to the root `.claude/…` if the repo should use it too). A new agent category directory, a new skill or a new command group must also be listed in `AGENTS_MAP`, `SKILLS_MAP` or `COMMANDS_MAP` in [`init/asset-maps.ts`](packages/@monomind/cli/src/init/asset-maps.ts#SKILLS_MAP) (skills named `mastermind-*` are matched by a wildcard), or `init` will not copy it.
- **Editing an existing one:** edit the root `.claude/` copy, then run `pnpm run sync:claude-trees`.
- **Org skills:** add them under `packages/@monomind/cli/org-skills/<name>/` with 3-5 tags from `TAGS.md`. Import third-party ones with `monomind org skills import … --into packages/@monomind/cli/org-skills` and add the repository to `SOURCES.md`.
- **Checks** (all run in `pnpm run verify` or CI):

  ```bash
  pnpm run lint:agent-refs         # every subagent_type, agentSlug and Skill(...) named in shipped files exists
  pnpm run sync:claude-trees:check # the copies agree
  pnpm run lint:skills             # monomind commands named in skills exist; synced skills are identical
  pnpm run pick:eval               # top-1/top-3 picks on tests/pick-eval (60 tasks)
  pnpm run docs:counts             # refresh the counts on this page and the site
  ```

  When a new agent or skill should win certain tasks, add those tasks to `tests/pick-eval/dataset.json` and run `pnpm run pick:eval` before and after.

  To check picks against real use, run `node scripts/pick-eval.mjs --logs` in a project with hook logs: it re-ranks the prompts that led to a spawn and reports how often the current ranker agrees with the agent actually spawned. `--export real.json` writes them in the dataset format; review the previews for private text before moving any into `tests/pick-eval`.

---

## See also

- [Routing](./routing.md) — the picker, thresholds, the `[PICK]` line, selectors, the learning loop and evaluation
- [`monomind pick`](../commands/cli-reference.md) and [`monomind route`](../commands/route.md)
- [Hooks](./hooks.md) — the prompt hook and the adherence hook
- [MCP Server](./mcp-server.md) — the `pick` and `org_skill_show` tools
- [Skill Catalog](./catalog.md) — importing and approving third-party skills
- [Org Runtime](./org-runtime.md) — role skills, auto-assignment and per-task skill suggestions
