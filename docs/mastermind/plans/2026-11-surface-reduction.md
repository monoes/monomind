# Surface reduction: a proposal (2026-11)

Status: **Proposed**, for the maintainer to decide. Nothing here is implemented;
no agent, skill, command, generator or code was changed while writing it.

All file references are against `origin/main` at the time of writing. Paths
without a prefix are under `packages/@monomind/cli/src/`. Counts marked
**(computed)** were recomputed for this plan with the repo's own counting
functions in `scripts/doc-counts-source.mjs`; counts marked **(README marker)**
are the generated values in `README.md` that could not be recomputed here.

## Context

Monomind ships far more surface than anyone uses. The only usage data in the
repo is a comment in `init/packs.ts:12-22`:

> The 2026-09 value review found 7 of 88 agents ever spawned in 702
> transcripts; a scan of ~2,700 maintainer transcripts (2026-09-30) agrees:
> besides built-ins, spawns went to coder, reviewer, researcher, Frontend
> Developer, Security Engineer, tester, Technical Writer, Software Architect,
> Monodesign, Git Workflow Master and DevOps Automator; the skills invoked were
> the mastermind workflows (review, repeat, plan, execute, debug), monodesign,
> agent-browser-testing and github-toolkit; the only slash commands were
> /mastermind:review and /mastermind:do.

That review already shrank what `init` installs by default (the `core` pack,
GH #411, `init/packs.ts:1-11`), but everything still ships, is still
maintained, still counted in docs, and still mirrored to four asset trees
(`pnpm run sync:claude-trees`, `package.json:34`).

**Unverified:** the 702 and ~2,700 transcripts themselves are not in the repo,
and the history that added the comment is not in this shallow clone. The
figures are quoted, not reproduced. The data covers the maintainer's own use;
there is no telemetry from other users for any surface.

## 1. Inventory

| Surface | Count | Usage evidence | Core pack (default install) | Opt-in |
|---|---|---|---|---|
| Agents (shipped tree) | 87 files, **83 pickable** (computed; 4 are `deprecated: true`, rule at `scripts/doc-counts-source.mjs:150-173`); README says 83 (`README.md:39`) | 7 of 88 spawned in 702 transcripts; 11 named non-built-in agents in ~2,700 (`init/packs.ts:12-17`) | 20 agents (computed via `countInstalledAgents`, entries at `init/packs.ts:91-108`) | 63 across `swarm` 13, `github` 6, `testing` 8, `specialists` 31, `business` 5 (computed from `init/packs.ts:111-325`) |
| Skills (Claude/platform) | 87 skill dirs in the package tree, **82 in the pick index** (computed via `countShippedIndex`); README says 82 (`README.md:39`) | 8 named skills/families used (`init/packs.ts:17-19`) | 26 (`init/packs.ts:40-68`) | `orgs` 30, `org-admin` 20, `extras` 11 (`init/packs.ts:115-145`, `:163-182`, `:299-311`) |
| Org skills | **560** (computed via `countOrgSkills`; `README.md:39`) | None recorded | n/a (served through `org_skill_show`, `mcp-client-roster.ts:49`) | n/a |
| `/mastermind:*` commands | **40** (computed; 41 files minus `_repeat.md`) (`README.md:40`) | Only `/mastermind:review` and `/mastermind:do` used (`init/packs.ts:19-20`) | 16 mastermind + 4 others (`init/packs.ts:69-90`) | `orgs` 9, `business` 5, `extras` 11 (`init/packs.ts:147-157`, `:291-297`, `:312-324`) |
| All slash commands | 96 in the pick index (computed) | as above | 21 command files (computed) | 83 command files (computed) |
| Top-level CLI commands | **39** (computed from `COMMAND_LOADERS`, `commands/index.ts:16-56`; `README.md:447`) | None recorded | n/a | n/a |
| `org` subcommands | **40** (computed via `countOrgSubcommands`; `README.md:199`) | None recorded | n/a | n/a |
| `hooks` subcommands | 28 (computed; `init/generated-counts.ts:15`) | Hook invocations are automatic; no per-subcommand data | n/a | n/a |
| MCP tools | **204** total, **21** advertised by default (README marker, `README.md:352`). `CORE_ADVERTISED_TOOLS` lists 22 names (`mcp-client-roster.ts:38-67`); the count keeps the registered ones (`scripts/doc-counts-source.mjs:276-290`) | None: no MCP call log found in `mcp-server.ts`, `mcp-client.ts` or `mcp-client-registry.ts` | 21 advertised | rest callable by name / `MONOMIND_MCP_FULL=1` |
| Init platforms | 5 in plain `init` (`init/detect-platforms.ts:17`); 16 adapter ids (`platform-adapters/registry.ts:14-31`); extra `--target` values cline, aider, qwen, crush, agents (`commands/init.ts:137-149`); side writers for copilot, pi, kilo (`init/executor.ts:300-306`) | None | Claude Code is the fallback (`init/detect-platforms.ts:1-5`) | detected/selected |
| Instruction-file generators | 8 content sources (section 4) | n/a | CLAUDE.md | per platform |

**Unverified:** the 204 MCP tools total needs a built CLI
(`scripts/doc-counts-source.mjs:279-281`); this checkout has no `dist/`. A grep
of `mcp-tools/` puts the biggest groups at monograph (~47), hooks (~28),
browser (~28), memory (~20) and claims (~12). Those are grep counts, not
registry counts.

## 2. Retire / demote candidates

Mechanisms that already exist and that the deprecation path reuses:
- agent frontmatter `deprecated: true` + `deprecatedBy:` (still spawnable,
  never ranked): e.g. `.claude/agents/github/monoswarm-pr.md:8-9`; registry
  counts in `commands/doctor-pick-checks.ts:82-115`;
- `hidden: true` on a `Command` (`types.ts:31`), used by `report-crash`
  (`commands/report-crash.ts:17`);
- hash-gated removal of shipped files on upgrade, so files the user edited
  stay put (`init/retired-files.ts:1-17`, data in `init/retired-files-data.ts`).

New piece, needed once: a `doctor` check that warns when a project still has
a deprecated asset installed, or when a deprecated CLI command or MCP tool was
run (a one-line stderr warning from the command itself). The rollout is the
same for every candidate: **release N** sets the deprecated flag, adds the
doctor/stderr warning and a CHANGELOG entry. **Release N+1** (at least one
minor later) removes it and adds its hashes to `retired-files-data.ts`.

| # | Candidate | Evidence | User-visible impact | Path | Risk |
|---|---|---|---|---|---|
| C1 | **`org-admin` "bookkeeping only" skills**: access, environments, invite-landing, invites, join-queue, plugin-manager, secrets (7) | Their own descriptions say "bookkeeping only — not enforced by the Org Runtime" (`.claude/skills/mastermind-access/SKILL.md:3`, `…-environments/SKILL.md:3`, `…-invite-landing/SKILL.md:3`, `…-invites/SKILL.md:3`, `…-join-queue/SKILL.md:3`, `…-plugin-manager/SKILL.md:3`, `…-secrets/SKILL.md:3`); none in the used set (`init/packs.ts:17-19`) | Users who opted into `org-admin` lose UIs that write side files nothing reads. `mastermind-secrets` users may believe secrets are protected; removing it takes away a false sense of safety | Deprecate (description prefix + doctor warning) → remove from `org-admin` pack → retire files | Low. Possible hidden dependency from other org skills linking them by path: grep before removal |
| C2 | **Remaining `org-admin` skills** (13: plugins, plugin-settings, adapters, adapter-manager, env, backup, export, import, instance, profile, workspaces, workspace-detail, tree-control) | Not in the used set (`init/packs.ts:17-19`); already opt-in (`init/packs.ts:160-186`) | None by default. Opt-in users lose skill wrappers; the `monomind org …` CLI stays | Demote: keep the CLI, drop the skill wrapper where a CLI subcommand does the same, folding the doc into `mastermind-org` | Medium: each needs a check that its CLI equivalent exists (`org` has 40 subcommands, `README.md:199`) |
| C3 | **`orgs` pack skill sprawl** (30 skills, 9 commands) | Not in the used set; only `mastermind-org` is core (`init/packs.ts:52`) | Opt-in only | Merge the `*-detail` / list pairs (agents + agent-detail, issues + issue-detail + my-issues, goals + goal-detail, routines + routine-detail, approval-detail + inbox) into one skill per noun, roughly 30 → 12 | Medium: the org-runtime feature is real (`commands/org.ts`); the risk is breaking deep links in skill bodies |
| C4 | **Deprecated agents still shipped** (4) | `deprecated: true` already set (`.claude/agents/github/monoswarm-pr.md:8`, `…/monoswarm-issue.md:8`, `.claude/agents/engineering/engineering-code-reviewer.md:7`, `.claude/agents/specialized/mobile/spec-mobile-react-native.md:7`); packs mark two "never installed" (`init/packs.ts:226-228`, `:258`) | None (never ranked, never installed) | Already at stage N: go straight to removal | Very low |
| C5 | **`specialists` pack** (31 agents: WeChat, Feishu, Solidity, embedded, …) | None of the 31 in the used list (`init/packs.ts:14-17`) | Opt-in only. Removing it means specialist picks fall back to core agents | Demote: ship them as Org skills or a separate catalog (`catalog` command, `commands/index.ts:34`) rather than as installable agents; or simply keep opt-in and stop counting them in headline numbers | Low on usage; **reputation risk**: "83 agents" is marketing copy (`README.md:39`) |
| C6 | **`swarm` pack commands** (41 command files across coordination, automation, stream-chain, agents, hooks, analysis, monitoring, optimization, workflows, truth: `init/packs.ts:189-203`) | Zero non-mastermind slash commands used (`init/packs.ts:19-20`); `coordination:agent-spawn` "starts no process" (`commands/agent-lifecycle-spawn.ts:18`) | Opt-in only | Retire commands that only describe a CLI call; keep `hooks:setup` | Low |
| C7 | **`business` and low-use `extras` mastermind commands** (marketing, sales, finance, content, ops; okf-export/import, master, understand, graph-status) | Unused (`init/packs.ts:19-20`) | `/mastermind:*` count drops from 40 | Deprecate → remove; keep `adr`, `code-review`, `release`, `techport` in `extras` | Low–medium: `business` is a positioning bet, not a usage one; maintainer call |
| C8 | **CLI overlap: `route` vs `pick`** | `route` is "routing through the central picker" (`commands/route.ts:1-4`, `:29`); `pick` is the picker (`commands/index.ts:33`) | Scripts calling `monomind route` see a deprecation line | Fold `route`'s outcome subcommands (`commands/route.ts:9-21`) under `pick`; `route` becomes a hidden alias (`types.ts:31`) for one release | Medium: hooks call route; grep `.claude/helpers` before |
| C9 | **CLI: `agent spawn` / `task` / `session` record-keeping** | `agent spawn` "Record a new agent in the agent store (starts no process)" (`commands/agent-lifecycle-spawn.ts:18`) | Unknown, no data | **Needs data first**: add opt-in local counters (stage 0) before deciding | Unknown, so do nothing yet |
| C10 | **MCP tools beyond the 21 advertised** (~183) | No call telemetry exists | None by default (not advertised) | **Needs data first**: log tool name + count locally (stage 0), then retire tools with zero calls over two releases; `claims_*` (~12) and duplicate `hooks_*` routing tools are the first suspects | Medium: other platforms' instruction files name tools directly (`init/geminimd-generator.ts:41-46`); `pnpm run lint:tool-refs` catches stale references (`package.json:46`) |
| C11 | **Org skills (560)** | No usage data | Picks cover them (`README.md:39`) | Needs data first; at minimum stop listing the number as a headline feature | Low |

## 3. Platform tiers

Today the README names five platforms (`README.md:34`, `:52`) and plain
`init` targets exactly those (`init/detect-platforms.ts:17-26`). Init also
carries writers for cline, aider (`init/executor.ts:384-388`), copilot, pi and
kilo (`init/executor.ts:300-306`), an `agents`-only target for pi, grok,
copilot, qwen, crush and others (`init/write-agents.ts:1-7`), and an adapter
registry with 16 ids (`platform-adapters/registry.ts:14-31`). The registry
already marks a capability `experimental` until it has schema or runtime
evidence (`platform-adapters/registry.ts:45-60`, levels at
`platform-adapters/types.ts:17`).

| Tier | Platforms | Gets | Support promise |
|---|---|---|---|
| **1** | Claude Code | Full CLAUDE.md, all packs, hooks, statusline, settings, skills/commands/agents (`init/executor.ts:297-327`) | Every feature lands here first; CI e2e |
| **2** | Codex, OpenCode, Antigravity, Kimi Code (the other four in `README.md:34`) | MCP config + the shared instruction file (section 4) + skills/commands where the platform has them natively; hooks only where the registry says `native` | Tested per release (existing tests: `__tests__/codex-generator.test.ts`, `__tests__/opencode-generator.test.ts`, `__tests__/kimi-generator.test.ts`, `__tests__/write-gemini-opencode-force-preserves.test.ts`) |
| **3** | everything else: copilot, cursor, vscode, aider, kiro, trae, openclaw, droid, hermes, gemini (CLI), zed, cline, pi, kilo, qwen, crush | `AGENTS.md`-style instruction block + the printed MCP install line only (as `write-cline.ts:16-17` does) | Best-effort, `experimental` label, no feature parity promise |

What changes in init:
1. `--target` / `--platforms` accept tier-3 ids only behind an explicit flag;
   they never come from detection. Plain `init` stays tier 1 + detected tier 2
   (unchanged from `init/detect-platforms.ts:87`).
2. Stop the **implicit** tier-3 side writers: `writePiMeshExtension` writes a
   project file whenever `~/.pi` exists in the user's *home*
   (`init/write-pi.ts:19-20`); the kilo plugin (`init/write-kilo.ts:17-18`) and
   copilot hooks (`init/write-copilot.ts:25-31`) do the same based on project
   files. Under the tiers they run only when the platform is named.
3. `monomind platforms` (`commands/index.ts:41`) prints the tier next to each id.
4. Legacy per-target writers and the adapter pass both run today ("The legacy
   target writers above remain compatibility projections", `init/executor.ts:362-380`).
   Tier 3 goes adapter-only; tier 2 keeps its writers until section 4 lands.

## 4. One shared instruction-file generator

### Today: eight content sources for one message

| Source | Writes | Shape |
|---|---|---|
| `init/claudemd-generator.ts:166` (+ `claudemd-sections-core.ts`, `claudemd-sections-reference.ts`, 602 lines total) | CLAUDE.md, managed block `claude-md` (`init/write-claude.ts:280-285`) | Full |
| `init/geminimd-generator.ts:15` | GEMINI.md, block `gemini-md` (`init/write-antigravity.ts:33-43`) | Hard-coded `version = '2.8.0'` (`:16`) while the CLI is 2.29.1 (`package.json:3` of the cli package); `memory_kg_search` listed twice (`:44`) |
| `init/codex-generator.ts:211` | AGENTS.md, skip-if-exists (`init/write-codex.ts:136-141`) | Codex |
| `init/opencode-generator.ts:312` | AGENTS.md, managed block (`init/write-opencode.ts:68-92`) | OpenCode |
| `init/kimi-generator-agents-md.ts:11` | AGENTS.md, skip-if-exists (`init/write-kimicode.ts:74-84`) | Kimi |
| `init/write-agents.ts:19` | AGENTS.md, skip-if-exists (`:53-66`) | "runtime-neutral part of the Codex target's AGENTS.md" (`:9-11`): a hand copy |
| `init/write-cline.ts:19` | `.clinerules/monomind.md` | Its first three lines repeat `platformInstruction` word for word |
| `platform-adapters/renderers/instructions.ts:10-41` | Block `instructions:<id>` in CLAUDE.md / GEMINI.md / AGENTS.md / CONVENTIONS.md / copilot-instructions (`platform-adapters/registry-paths.ts:11-208`) | Short |

Consequences: four writers race for `AGENTS.md` with different policies. The
kimi writer documents the clash: "under --force the two generators would
otherwise flip the file depending on write order"
(`init/write-kimicode.ts:74-78`). A Claude project also gets **two** monomind
blocks in CLAUDE.md, one from `writeClaudeMd` and one from the adapter pass
(`init/executor.ts:325-327` and `:362-380`). The root `CLAUDE.md` of this repo
shows both. `.agents/shared_instructions.md` is a ninth, separate output
(`init/shared-instructions-generator.ts:131`, written at `init/executor.ts:391-395`).

### Design

```
init/instructions/
  body.ts        renderBody(profile: InstructionProfile): string   // sections, one source
  sections.ts    the section functions now in claudemd-sections-*.ts
  headers.ts     HEADERS: Record<PlatformId, (ctx) => string>     // ≤15 lines each
  write.ts       writeInstructionFile(target, platform, opts)      // one merge policy
```

- `InstructionProfile = { platform, tier, tools: 'mcp'|'cli', hooks: boolean,
  skills: 'native'|'portable'|'none', packs: string[] }`. Sections are chosen
  from this profile, never from the platform name, so tier 2 and tier 3 get the
  same text when their capabilities match. The capabilities come from
  `PLATFORM_REGISTRY` (`platform-adapters/registry.ts:66`).
- The header is the only per-platform text: where the MCP config lives
  (`.codex/config.toml`, `.kimi-code/mcp.json`, …), status-line notes, the
  privacy line.
- **One file, one block per file.** `AGENTS.md` gets a single
  `monomind:agents-md` managed block. When several selected platforms share
  AGENTS.md, it carries the union of their headers. That ends the
  write-order flip.
- Merge goes through the existing `mergeBlock` / `managed-block.ts:238`
  primitive for every file. The skip-if-exists policies end; the legacy
  unmarked-body migration (`managed-block.ts:198-230`) covers old files.
- Version strings come from `package.json`, never a literal.
- The adapter's `renderInstruction` (`platform-adapters/renderers/instructions.ts:21`)
  calls `renderBody` with a tier-3 profile instead of keeping its own text.

Replaced: `claudemd-generator.ts` (kept as a 10-line shim for its exports
until stage 4), `claudemd-sections-core.ts`, `claudemd-sections-reference.ts`,
`generateGeminiMd`, `generateCodexAgentsMd`, `generateAgentsMd` (opencode),
`generateKimiAgentsMd`, `generateAgentsOnlyMd`, `clineRule`,
`platformInstruction`. `shared-instructions-generator.ts` stays: it writes
language best practices and memory seeds, not product instructions.

Tests to fold into one table-driven `instructions.test.ts` (snapshot per
profile + invariants: one block per file, no unknown tool names, no literal
version): `src/__tests__/claudemd-truth.test.ts` (444 lines),
`claudemd-lean.test.ts`, `claudemd-agent-picking.test.ts`,
`claude-md-stack-commands.test.ts`, `codex-generator.test.ts`,
`kimi-generator.test.ts`, `opencode-generator.test.ts`. Keep as integration
tests (they cover merge and preserve behaviour, not content):
`write-claude-md-force-preserves-content.test.ts`,
`write-gemini-opencode-force-preserves.test.ts`,
`write-opencode-agents-md-preserves-content.test.ts`,
`init-managed-block-upgrade.test.ts`, `__tests__/init-coder-targets.test.ts`,
`privacy-claims.test.ts`.

**Unverified:** I did not read every assertion in those tests. The claim that
the first seven are content-only comes from their names and imports, so check
each one before deleting it.

## 5. Staged rollout

| PR | Scope | Effort | Depends on |
|---|---|---|---|
| 0 | **Measure.** Opt-in, local-only counters: CLI command name, MCP tool name, slash command / skill invoked (the pick-adherence log already exists, `commands/doctor-pick-checks.ts:66-69`). `doctor` reports them | 2–3 d | — |
| 1 | **Deprecation plumbing.** `deprecated` on skills, commands, CLI commands and MCP tools; doctor check "deprecated asset installed / used"; stderr line | 2 d | — |
| 2 | **Quick retirements:** C4 (remove 4 deprecated agents), C1 (deprecate 7 bookkeeping skills), C6/C7 deprecate | 1 d + 0.5 d removal in N+1 | 1 |
| 3 | **Platform tiers:** tier field on `PLATFORM_REGISTRY`, gate implicit pi/kilo/copilot writers, tier column in `platforms`, README platform section | 2–3 d | — |
| 4 | **Shared instruction generator:** `init/instructions/*`, migrate CLAUDE.md first (snapshot must match today's block byte-for-byte), then GEMINI.md, then the four AGENTS.md writers in one go; single AGENTS.md block | 5–7 d | 3 |
| 5 | **Drop the duplicate CLAUDE.md block:** skip the adapter instruction pass for platforms whose block section 4 now writes | 0.5 d | 4 |
| 6 | **Org skill consolidation** (C2, C3): 50 → ~20 skills | 3–4 d | 1 |
| 7 | **CLI merge** `route` → `pick` (C8) | 1–2 d | 1 |
| 8 | **Data-driven pass** (C9, C10, C11) after two releases of stage-0 data | 2–5 d | 0 |

Every PR runs `pnpm run test:all:run`, `pnpm run sync:claude-trees:check` and
`pnpm run docs:counts:check` (`package.json:32`, `:35`, `:41`), because doc
counts and the four asset trees move with every removal.

## Trade-offs

- **Gained:** fewer files to keep correct across 4 mirrored trees; honest
  headline numbers; one place to fix instruction text (the GEMINI.md version
  drift is the kind of bug that goes away); smaller opt-in listings.
- **Lost:** breadth as a selling point ("83 agents, 560 Org skills"); some
  users of opt-in packs we have no data on; a removal cycle per candidate.
- **Reversible:** everything before the N+1 removal is a flag flip. Removed
  assets stay in git history and can come back as an opt-in pack.

## Decisions for the maintainer

1. Accept the tier table (section 3), especially moving copilot to tier 3.
2. Approve C1 + C4 now (evidence is in the files themselves).
3. Approve stage 0 measurement before touching CLI and MCP surfaces.
4. Decide whether `business` (C7) stays as a positioning bet.
