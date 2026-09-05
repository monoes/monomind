# Mastermind Prompt-to-Product Pipeline Repair Plan (v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Deliberate deviation from the house-style banner.** Every prior plan in `docs/mastermind/plans/` opens with `Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")``. `mastermind-taskdev` **does not exist** — it is absent from `.claude/skills`, `.agents/skills`, `.gemini/skills`, `.kimi-code/skills`, `packages/@monomind/cli/.claude/skills`, and every `commands/` tree (verified exhaustively; `find . -iname '*mastermind*taskdev*'` returns zero results). Naming it as the *recommended* worker sends every plan-executing agent into an immediate dead end. Task 1 of this plan removes that banner from the skill that generates it; this document does not propagate it.

---

## v1 — Independent Opus re-review corrections to the 89-agent swarm report

This plan was produced by re-verifying every load-bearing claim in `/tmp/mastermind_review_report.md` and `/tmp/mastermind_review_findings.json` against the live working tree on 2026-09-05. The swarm report is broadly correct and unusually well-evidenced. Nine things changed:

1. **The `mastermind-plan` body duplication is NOT a repository bug — it is uncommitted damage in the current working tree.** `git show HEAD:.claude/skills/mastermind-plan/SKILL.md | wc -l` → **217**; the working tree has **429**. Same for `mastermind-execute` (HEAD 104, worktree 203) and `mastermind-debug` (HEAD 277, worktree 551). All three are listed as ` M ` in `git status`. The report framed this as a defect to fix inside the skill; the correct action is `git checkout` — and, critically, **any hand-edit applied to the corrupted working-tree copies would have to be applied twice and would be destroyed on restore.** This makes de-corruption a hard prerequisite for every other skill edit, which is why it is now Task 0.
2. **The duplication is broader than reported.** It affects three skills, not one, and `.agents/skills/mastermind-{plan,execute,debug}/SKILL.md` carry **four** stacked copies (`skills:claude`, `skills:opencode`, `skills:kimi`, `skills:codex` marker blocks) — and *that* duplication **is committed** (`.agents/skills/mastermind-plan/SKILL.md` is 853 lines at HEAD). So there are two distinct problems wearing one name: a local working-tree accident and a committed generator defect.
3. **The Brain Load/Write MCP tool-name finding is mostly wrong.** The report claimed eight tools called by `mastermind-protocol/SKILL.md` are unregistered. Verified: **eight of ten are registered and correct** (`memory_hierarchical-recall` at `memory-tools.ts:641`, `memory_pattern-search` at `:136`, `memory_context-synthesize` at `:828`, `memory_hierarchical-store` at `:592`, `memory_pattern-store` at `:80`, `memory_health` at `:39`, `monograph_query`, `monograph_community` at `group-tools.ts:9`). Only `memory_stats` and `monograph_add_fact` are unregistered. The real casualty is **`.claude/commands/mastermind-brain.md`, where 10 of 13 tool calls use the removed `lancedb_*` prefix** and every one of them is dead. Task 6 is re-scoped accordingly: protocol needs two line fixes, `brain.md` needs a rewrite.
4. **`mastermind-master.md` has eight dangling skill references, not three** — and one of them is far more damaging than `mastermind-taskdev`. Line 107 routes *"Build a feature, fix a bug, implement anything"* — the single most common request a user can make — to `Skill("mastermind-build")`, which does not exist. Also missing: `mastermind-architect` (L110), `mastermind-autodev` (L126), `mastermind-approvev1` (L125), plus `-verify` (L98), `-tdd` (L99), `-taskdev` (L102,103), `-finish` (L119). **This is the most important thing the original review missed.**
5. **The `<org>-issues.json` schema fix must be applied five times, not once.** `mastermind-{issues,issue-detail,my-issues,liveness,plan-to-tasks}/SKILL.md` are **byte-identical across all five skill trees** (`.claude`, `.agents`, `.gemini`, `.kimi-code`, `packages/@monomind/cli/.claude`). The report treated this as "a single, mechanical fix across four files"; it is a mechanical fix across **twenty-five** files. Task 2 therefore edits one canonical copy and syncs by checksum rather than hand-editing each.
6. **Two additional field drifts the report did not name.** `mastermind-my-issues` writes `lastActivityAt` (lines 91, 108, 123) — a field **nothing else ever reads**, while `mastermind-liveness`'s stale-heartbeat check reads `updatedAt` (line 156). So self-assigning an issue never refreshes its heartbeat. And `mastermind-issue-detail show` reads `.project_id` (line 83) while `mastermind-issues create` writes `workspaceId` (line 149) — the project field is never populated by any writer.
7. **A new correctness bug in the liveness contract the report did not find: human-owned issues are audited as agent work.** `mastermind-my-issues assign-self` writes the operator id (default `local-operator`) into `assigneeId` (line 91). `mastermind-liveness check` computes `aId = iss.get("assigneeAgentId") or iss.get("assigneeId")` (line 114), so a human assignee is read as an agent, the `uId and not aId` user-owned escape at line 121 never fires, and the issue is subjected to strict execution-path checks it can never satisfy. Every self-assigned issue is a false stall (or, given the `else: healthy` fallthrough, a false *healthy* — see the next item).
8. **A latent crash in `liveness check`.** Line 134 builds `{i["id"] for i in issues ...}` with direct indexing. Any issue record lacking an `id` key raises `KeyError` and aborts the entire audit. Every other access in the file uses `.get()`.
9. **`mastermind-tasks` DOES have a `parent_id` input** (line 22) — the report said it had none. The dead end is real but differently shaped: `parent_id` exists and is routed to `monotask card subtask add` (line 91), i.e. to the wrong data store. Separately, `mastermind-tasks` introduces a **fourth** status vocabulary (`todo | doing | done`, line 24).

**Backward-compatibility determination and the `#4` reversal are stated in their own sections below.**

---

**Goal:** Make the Mastermind pipeline compose — every stage's declared handoff reaches a skill that exists, every skill that reads `<org>-issues.json` agrees with every skill that writes it, and the connective tissue is guarded by a linter so it cannot silently re-rot.

**Architecture:** Three layers get repaired independently. (1) *Reference integrity* — skill-to-skill `Skill("…")` calls and router tables must name real skills. (2) *Data contract* — one canonical camelCase field schema and one status vocabulary for the `<org>-issues.json` sidecar, enforced at every read and write site. (3) *Honesty* — where a bridge does not exist (issues sidecar ↔ `OrgDaemon`), the skills say so explicitly rather than implying a handoff that never happens. A CI-wired linter turns all three into regressions instead of rediscoveries.

**Tech Stack:** Markdown `SKILL.md` packages with embedded `bash` + `python3` + `jq`; TypeScript (ESM, `.js` import suffixes) in `packages/@monomind/cli/src/orgrt/`; Node 24 / pnpm 10.18.1 / Vitest; `scripts/lint-skills.mjs` as the guard.

---

## Global constraints

- **The workspace package name is `@monoes/monomindcli`** (directory `packages/@monomind/cli`). Every filtered command uses `pnpm --filter @monoes/monomindcli`. `pnpm --filter @monomind/cli` resolves to nothing.
- **Verified toolchain on this machine:** `node v24.20.0`, `pnpm 10.18.1`, `Python 3.12.3`, `jq-1.7`. The skills' `python3` heredocs and `jq` filters are safe to rely on.
- **`npm run lint` (biome) never touches skill files.** `biome.json` `includes` covers only `packages/*/src/**`, `packages/@monomind/*/src/**`, `tests/**`, `scripts/**`, and explicitly excludes `!**/.claude`. No existing gate reads a `SKILL.md`. This is why Task 8 exists.
- **`scripts/lint-skills.mjs` exists but is wired to nothing.** Its own header claims "CI: fails on…", but grep across all `*.json`/`*.yml`/`*.yaml`/`*.mjs`/`*.md` finds no `package.json` script and no workflow invoking it. It is run manually or not at all.
- **`tests/repo/claude-tree-parity.test.ts:215` compares the *set of skill directory names*** between `.claude/skills/` and `packages/@monomind/cli/.claude/skills/`. It does not compare file contents. Editing a `SKILL.md` will not trip it; **adding a new skill directory to only one tree will.**
- **No test anywhere references `issues.json`, `-issues.json`, or `mastermind-issues`.** Verified across `tests/`, every `__tests__/`, and every `*.test.*`/`*.spec.*` repo-wide. A field rename requires zero test updates.
- The five skill trees are `.claude/skills`, `.agents/skills`, `.gemini/skills`, `.kimi-code/skills`, `packages/@monomind/cli/.claude/skills`. `.gemini`, `.kimi-code`, and `packages/@monomind/cli/.claude` are byte-identical to each other and hold the **clean** (non-duplicated) copies — they are the canonical baseline for `mastermind-{plan,execute,debug}`.
- Do not add a `mastermind-taskdev`, `mastermind-finish`, `mastermind-tdd`, `mastermind-verify`, `mastermind-build`, `mastermind-architect`, `mastermind-autodev`, or `mastermind-approvev1` skill as part of this plan. Building eight new skills is a feature project; this plan makes the existing references honest. Where a router row has no real destination, it is rewritten to point at a real skill or removed — never left dangling.
- Every issue-file write in these skills must be atomic (write to `${file}.tmp`, then `mv`). `mastermind-issues` and `mastermind-liveness` currently use in-place `open(path, "w")`, which truncates the file if the process dies mid-write. This is corrected wherever those blocks are already being edited, and nowhere else.

---

## The canonical issue schema (implemented verbatim in Task 2)

This table is the contract. Every skill that touches `.monomind/orgs/<org>-issues.json` conforms to it.

| Field | Type | Written by | Meaning |
|---|---|---|---|
| `id` | string | issues.create, plan-to-tasks | `issue-<epochMs>-<NNN>`; the `-<NNN>` suffix is new and prevents same-millisecond collisions during batch creation |
| `title` | string | issues.create, plan-to-tasks | required, non-empty |
| `description` | string | issues.create, plan-to-tasks | may be `""` |
| `status` | enum | all | `todo` \| `in_progress` \| `blocked` \| `in_review` \| `done` \| `cancelled` |
| `priority` | enum | issues.create/update, plan-to-tasks | `low` \| `medium` \| `high` \| `urgent` |
| `assigneeId` | string\|null | all assign paths | display/filter assignee, either kind |
| `assigneeAgentId` | string\|null | issue-detail.assign, liveness.checkout | set **only** when an agent owns execution |
| `assigneeUserId` | string\|null | my-issues.assign-self | set **only** when a human owns it |
| `parentId` | string\|null | issues.create (new `--parent-id`) | sub-issue parent |
| `projectId` | string\|null | plan-to-tasks | |
| `workspaceId` | string\|null | issues.create, plan-to-tasks | |
| `blockedByIssueIds` | string[] | plan-to-tasks | issue **ids**, never titles |
| `recoveryStatus` | string | issue-detail.recover | `none` \| `accept` \| `reject` |
| `recoveryActions` | object[] | liveness.recover | |
| `checkoutRunId`, `executionRunId`, `checkedOutAt` | string | liveness.checkout | |
| `createdAt`, `updatedAt`, `closedAt` | ISO-8601 Z | all | `updatedAt` is the heartbeat liveness reads |

**Retired spellings** (must not appear anywhere after Task 2): `assignee_id`, `assigned_to`, `created_at`, `updated_at`, `closed_at`, `project_id`, `parent_id`, `recovery_status`, `lastActivityAt`, and the status value `open`.

**Status vocabulary rationale.** `todo` is the initial state, not `open`. `mastermind-liveness`'s Liveness Contract (lines 41–48) is the only place in the pipeline where the status set is *defined* rather than merely used, and it gives each of `todo`/`in_progress`/`blocked`/`in_review` a written execution expectation. `open` has no such semantics — adding it to `non_terminal_statuses` would mean inventing one. Aligning `mastermind-issues` to the contract is the smaller and better-specified change.

---

## Backward compatibility: does the schema migration need a one-time script?

**Answer: no standalone migration script. A five-line idempotent normalization is added to the shared load step instead.** Evidence and reasoning:

**In this repository — fully greenfield.**
- `ls .monomind/orgs/` contains exactly one file, `sample-team.json` (an org definition, not an issues sidecar).
- `find . -name "*-issues.json" -not -path "*/node_modules/*"` returns **zero results**. No issues sidecar has ever been created here.
- No test, fixture, or snapshot anywhere in the repo references `issues.json`, `-issues.json`, or any of the drifting field names (grepped across `tests/`, all `__tests__/`, and every `*.test.*`/`*.spec.*`).
- No TypeScript source constructs one. The only `src/` reader is the dashboard at `packages/@monomind/cli/src/ui/routes-org.mjs:927,982,1056,1326`, and it is read-only.

**In the field — not greenfield, but the existing data is already broken.** `packages/@monomind/cli/package.json` ships `.claude` in its `files` array, so these skills are published to npm users at v2.10.11. A user who ran `/mastermind:issues --action create` has a real sidecar on disk. But every such record was written with `status: "open"` and `assigneeId`, which means it was *already* invisible to `mastermind-liveness` (line 111 skips any status outside `non_terminal_statuses`) and already mislabeled by `mastermind-my-issues`. There is no correctly-functioning legacy state to preserve.

**Why normalization-on-read rather than a script.** A standalone migration script would have to be discovered and run by a user who has no reason to know it exists — there is no CLI command that owns migrations for skill-written sidecars, and `monomind doctor` does not inspect them. It would ship and never execute. A normalization pass in the load step that every one of these skills already runs is idempotent, costs one `python3` invocation, self-heals on first touch, and needs no user action. It is added once as **Task 2 Step 1** and removed from the plan's scope after two releases (tracked as a follow-up, not built here).

---

## Build order, and why it differs from the review's Top 5

| # | Review's Top 5 | This plan | Change |
|---|---|---|---|
| — | *(absent)* | **Task 0** — de-corrupt the working tree, fix the committed `.agents` duplication | **New, and first.** Editing corrupted copies means double-applying every change and losing it all on restore. Hard prerequisite. |
| 1 | Fix plan→execute→finish chain | **Task 1** | Kept first among the review's items. **Scope expanded** from 3 dangling refs to 8, adding `mastermind-build` — the router's answer to the most common user request. |
| 2 | Normalize `-issues.json` schema | **Task 2** | Kept. Scope expanded to 25 files, 2 extra field drifts, the human-vs-agent assignee bug, the `KeyError`, and the blocked/healthy fallthrough. |
| 3 | Give plan-to-tasks a real Step 4 | **Task 3** | Kept, and correctly sequenced after Task 2 — Step 4 must emit the canonical schema, so writing it first would guarantee rework. |
| — | *(part of §2.4)* | **Task 4** — sub-issue path | Promoted to its own task; it is the only remaining `parentId` writer gap. |
| — | *(part of §2.4)* | **Task 5** — `activity.jsonl` writer | Promoted. Seven readers, zero writers. |
| 5 | Collapse routers + brain tool drift | **Task 6** | Kept, **re-scoped**: `mastermind-protocol` needs 2 line fixes (not 8); `mastermind-brain.md` needs a rewrite (10 dead calls). |
| 4 | Bridge issues.json ↔ OrgDaemon TaskDag | **Task 7 — do NOT build the bridge** | **Reversed.** See below. |
| — | *(absent)* | **Task 8** — wire the skill linter into CI | **New, last.** Without it every fix above decays silently. |

### Task 4 of the review: why the issues.json → TaskDag bridge should NOT be built now

The review's #4 recommends making `OrgDaemon` load open issues from `<org>-issues.json` into its `TaskDag` at startup. **Do not do this yet.** Three verified reasons:

1. **The TaskDag does not survive a restart, so a bridge would feed a container that leaks.** `packages/@monomind/cli/src/orgrt/daemon.ts:1208` handles the `{ resume: true }` branch with a bare `new TaskDag()` — identical to the fresh-start branch at `:1222`. `TaskDag.fromJSON` (defined at `task-dag.ts:263`) is **never called anywhere in `src/`**. Every resume silently discards all DAG state. Seeding a container that is emptied on every restart adds a data-loss path rather than a feature.
2. **The vocabularies do not overlap.** `OrgTask` (`task-dag.ts:14-35`) is `{ id, title, assignee, deps, status, result?, createdAt, startedAt?, completedAt?, splitFrom?, mergedInto?, blockedUntil?, blockedReason? }` with statuses `pending|ready|running|blocked|done|failed|split|merged|cancelled`. The issue schema shares only `title` and a partially-overlapping `status`. `deps` are DAG-internal auto-generated ids (`task-${++counter}`, line 49), not issue ids. A faithful bridge requires a bidirectional id map and a decision about who owns `status` once both sides can write it — a design question, not a patch.
3. **`--task` is prose, not structure.** `commands/org.ts:154` reads the flag, `:440` passes it to `daemon.startOrg(name, taskFlag, …)` (`daemon.ts:504`), and it is used only as message text at `daemon.ts:1276,1283,1299,1306` (`taskOverride ?? def.goal`). Serializing issues into that string, as the review's fallback suggests, produces a prompt, not a task graph — with none of the dependency semantics that make the issues sidecar worth bridging.

**What Task 7 does instead:** fix the resume-path DAG loss and the crash-checkpoint hole (both real, both prerequisites for any future bridge), and make the two stages state the severance in their own text so no agent infers a handoff that does not exist. The bridge itself is deferred to a follow-up plan with an explicit id-mapping and status-ownership design.

---

## Task 0 — De-corrupt the skill trees and establish the canonical source

**Why first:** `.claude/skills/mastermind-{plan,execute,debug}/SKILL.md` are currently double-length uncommitted corruption. Every subsequent task edits skill files. Editing these three before restoring them means each edit must be applied to two copies and is destroyed the moment anyone runs `git checkout`.

### Step 0.1 — Confirm the corruption before touching anything

- [x] Run: (worktree numbers already equaled HEAD — no corruption in this worktree's `.claude/skills` copies; skipped to Step 0.3 per the plan's own branch)

```bash
cd /home/monoes/Desktop/monoes/repos/monomind
for f in mastermind-plan mastermind-execute mastermind-debug; do
  printf '%-22s HEAD=%-5s worktree=%s\n' "$f" \
    "$(git show HEAD:.claude/skills/$f/SKILL.md | wc -l)" \
    "$(wc -l < .claude/skills/$f/SKILL.md)"
done
```

**Expected output — this exact result is the precondition for Step 0.2:**

```
mastermind-plan        HEAD=217   worktree=429
mastermind-execute     HEAD=104   worktree=203
mastermind-debug       HEAD=277   worktree=551
```

If the worktree numbers already equal the HEAD numbers, someone has restored them; skip to Step 0.3.

### Step 0.2 — Restore the three files from HEAD

> **This discards uncommitted changes to three files.** They contain nothing but a duplicated copy of their own committed body (verified: `diff <(sed -n '8,217p' …) <(sed -n '219,428p' …)` is empty, both halves md5 `0b34cac6ee005830b05d31aed4832f6d`). Confirm with the user before running if any doubt remains about what else touched them.

- [ ] Run:

```bash
git checkout -- \
  .claude/skills/mastermind-plan/SKILL.md \
  .claude/skills/mastermind-execute/SKILL.md \
  .claude/skills/mastermind-debug/SKILL.md
```

- [ ] **Verify:**

```bash
md5sum .claude/skills/mastermind-plan/SKILL.md packages/@monomind/cli/.claude/skills/mastermind-plan/SKILL.md
```

**Expected:** both lines show the same hash (`59c12f647a…`), confirming `.claude` now matches the canonical baseline.

### Step 0.3 — Fix the committed 4× duplication in `.agents/skills`

`.agents/skills/mastermind-{plan,execute,debug}/SKILL.md` are committed at 853 / 401 / 1099 lines. Each is the canonical body followed by four marker-wrapped copies of itself:

| File | Canonical body | `skills:claude` | `skills:opencode` | `skills:kimi` | `skills:codex` |
|---|---|---|---|---|---|
| `mastermind-plan` | 1–217 | 218–429 | 218–429†| 430–641 | 642–853 |
| `mastermind-execute` | 1–104 | — | 105–203 | 204–302 | 303–401 |
| `mastermind-debug` | 1–277 | — | 278–551 | 552–825 | 826–1099 |

† the `.agents` copy's first appended block is the opencode one; the claude block is `.claude`-tree-only.

- [x] Truncate each `.agents` file to its canonical body:

```bash
sed -i '218,$d'  .agents/skills/mastermind-plan/SKILL.md
sed -i '105,$d'  .agents/skills/mastermind-execute/SKILL.md
sed -i '278,$d'  .agents/skills/mastermind-debug/SKILL.md
```

- [x] **Verify all five trees now agree:**

```bash
for f in mastermind-plan mastermind-execute mastermind-debug; do
  echo "--- $f"
  md5sum .claude/skills/$f/SKILL.md .agents/skills/$f/SKILL.md \
         .gemini/skills/$f/SKILL.md .kimi-code/skills/$f/SKILL.md \
         packages/@monomind/cli/.claude/skills/$f/SKILL.md | awk '{print $1}' | sort -u | wc -l
done
```

**Expected:** `1` printed under each of the three headings (one distinct hash per skill across all five trees).

### Step 0.4 — Record the generator defect without fixing it blind

The marker blocks are written by the platform-adapter install path. `packages/@monomind/cli/src/platform-adapters/operations.ts:210-231` (`artifactState`) decides ownership by testing whether the target already contains `monomind:start skills:<platform>`. The canonical `SKILL.md` bodies carry **no** marker, so every install reads them as *foreign*, and the managed-block merge appends a fresh full-body block rather than replacing one — once per platform, which is exactly the 1-to-4 stacking observed.

- [x] Read `packages/@monomind/cli/src/platform-adapters/merge.ts` and confirm the append-vs-replace path before changing it. **Do not patch `operations.ts` on the strength of the paragraph above** — it is a mechanism hypothesis derived from `artifactState` alone, not a traced defect. (Confirmed: `mergeManagedBlock` replaces on a marker match and only appends when no match is found; combined with `artifactState`'s per-platform marker check this explains the stacking. Per explicit instruction, no fix was applied to `merge.ts` or `operations.ts` — investigation only.)
- [ ] If confirmed, the fix belongs in `merge.ts`'s managed-block writer (replace the block whose marker matches; never append when the file already contains the payload). If not confirmed, open a follow-up and rely on Task 8's detector to catch recurrences.
- [ ] **Verify (detector, not fix):** Task 8 Step 8.2 adds a check that fails when any `SKILL.md` contains its own body twice. That check is the durable guard here; this step is investigation.

---

## Task 1 — Make every `Skill("…")` reference name a skill that exists

Eight names are referenced and none exist: `mastermind-taskdev`, `mastermind-finish`, `mastermind-tdd`, `mastermind-verify`, `mastermind-build`, `mastermind-architect`, `mastermind-autodev`, `mastermind-approvev1`.

**Routing decisions** (each dangling name maps to a real skill; verified present as a `.claude/skills/<name>/SKILL.md` directory):

| Dangling | Replacement | Rationale |
|---|---|---|
| `mastermind-taskdev` | `mastermind-execute` | Both are "execute a written plan"; execute exists and already handles per-task iteration. |
| `mastermind-finish` | `mastermind-review` | Mirrors the hard-gate pattern `mastermind-design` already uses into `mastermind-plan`. |
| `mastermind-tdd` | *inline instruction* | No test-writing skill exists. Replace the call with the instruction itself. |
| `mastermind-verify` | `mastermind-review` | Review is the verification stage. |
| `mastermind-build` | `mastermind-plan` | The pipeline's designed entry for "implement anything" is plan-then-execute. |
| `mastermind-architect` | `mastermind-design` | Design is the architecture stage. |
| `mastermind-autodev` | `mastermind-execute` | Closest real behavior. |
| `mastermind-approvev1` | *row removed* | v1-only; the row's own text says v2 approvals arrive in the dashboard. |

### Step 1.1 — `mastermind-plan/SKILL.md` (canonical, 217 lines after Task 0)

- [x] Replace line 76 (the banner inside the plan template):

```markdown
> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-taskdev")` (recommended) or `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
```

with:

```markdown
> **For agentic workers:** REQUIRED SUB-SKILL: Use `Skill("mastermind-execute")` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
```

- [x] Replace the entire Execution Handoff block, lines 195–217, with:

```markdown
## Execution Handoff

After the plan is approved (or in auto mode, after self-review):

**In confirm mode (default):** Ask the user to confirm execution:

**"Plan complete and saved to `docs/mastermind/plans/<filename>.md`. Execute it now with `mastermind-execute`?"**

**In auto mode:** Skip the question — invoke `Skill("mastermind-execute")` immediately.

**On execution:**
- Invoke `Skill("mastermind-execute")`
- It loads the plan, reviews it critically, and works task-by-task with checkpoints for review
```

### Step 1.2 — `mastermind-execute/SKILL.md` (canonical, 104 lines after Task 0)

- [x] Line 3, frontmatter description — replace `and hand off to mastermind:finish when complete.` with `and hand off to mastermind:review when complete.`
- [x] Line 14 — replace:

```markdown
**Note:** This skill works best with subagent support (Claude Code). When subagents are available, prefer `Skill("mastermind-taskdev")` for parallel task execution.
```

with:

```markdown
**Note:** This skill works best with subagent support (Claude Code). When subagents are available, dispatch one subagent per independent task in a single message.
```

- [x] Lines 50–53 — replace:

```markdown
When the plan references skills:
- `mastermind:taskdev` → invoke `Skill("mastermind-taskdev")`
- `mastermind:verify` → invoke `Skill("mastermind-verify")`
- Any other `mastermind:*` skill → invoke `Skill("mastermind-<name>")`
```

with:

```markdown
When the plan references skills:
- `mastermind:taskdev` → this skill; continue inline (no separate taskdev skill exists)
- `mastermind:verify` → invoke `Skill("mastermind-review")`
- Any other `mastermind:*` skill → invoke `Skill("mastermind-<name>")`
```

- [x] Lines 59–61 — replace:

```markdown
- Announce: "All tasks complete. Handing off to mastermind:finish."
- **REQUIRED SUB-SKILL:** invoke `Skill("mastermind-finish")`
- Follow that skill to verify tests, present options, and execute the chosen finish action
```

with:

```markdown
- Announce: "All tasks complete. Handing off to mastermind:review."
- **REQUIRED SUB-SKILL:** invoke `Skill("mastermind-review")`
- Follow that skill to verify the work before any merge, PR, or release step
```

- [x] Lines 100–104 (the Integration list) — replace with:

```markdown
**Skills used by this skill:**
- `Skill("mastermind-plan")` — creates the plan this skill executes
- `Skill("mastermind-review")` — verification gate after all tasks complete
- `Skill("mastermind-debug")` — when a task fails for a reason the plan did not anticipate
```

### Step 1.3 — `mastermind-debug/SKILL.md` (canonical, 277 lines after Task 0)

- [x] Line 160 — replace `   - Use \`Skill("mastermind-tdd")\` for writing proper failing tests` with:

```markdown
   - Write the test so it fails for the stated root cause, not for a setup error
```

- [x] Lines 268–270 — replace:

```markdown
**Related skills:**
- `Skill("mastermind-tdd")` — for creating the failing test case (Phase 4, Step 1)
- `Skill("mastermind-verify")` — verify the fix worked before claiming success
```

with:

```markdown
**Related skills:**
- `Skill("mastermind-review")` — verify the fix worked before claiming success
- `Skill("mastermind-plan")` — when the root cause turns out to need a multi-file change
```

### Step 1.4 — `.claude/commands/mastermind-master.md` routing table (lines 95–128)

- [x] Apply these exact line replacements: (line numbers had drifted slightly by the time of application due to earlier edits in this session; located each row by its quoted text instead — same net result)

| Line | Replace | With |
|---|---|---|
| 98 | `` `Skill("mastermind-verify")` `` | `` `Skill("mastermind-review")` `` |
| 99 | the whole row | `` \| Write tests first, enforce Red-Green-Refactor \| `Skill("mastermind-debug")` (Phase 4 covers the failing-test-first loop) \| `` |
| 102 | `` `Skill("mastermind-taskdev")` `` | `` `Skill("mastermind-execute")` `` |
| 103 | `` use `Skill("mastermind-taskdev")` for plan-driven parallel work `` | `` use `Skill("mastermind-execute")` for plan-driven parallel work `` |
| 107 | `` `Skill("mastermind-build")` `` | `` `Skill("mastermind-plan")` then `Skill("mastermind-execute")` `` |
| 110 | `` `Skill("mastermind-architect")` `` | `` `Skill("mastermind-design")` `` |
| 119 | `` `Skill("mastermind-finish")` `` | `` `Skill("mastermind-review")` `` |
| 125 | the whole row | *(delete — v1-only; v2 approvals arrive in the dashboard Human Input tab)* |
| 126 | `` `Skill("mastermind-autodev")` `` | `` `Skill("mastermind-execute")` `` |

- [x] Apply the identical edits to the two sibling copies: `.claude/commands/monomind-mastermind-master.md` (byte-identical, md5 `f38da0f2f19b1bbd0475c0b3a16aa4eb`) and `.claude/commands/mastermind/master.md` (near-copy, md5 `d0b362fc2fecd027c2ee6fdd75c4caa7`). Also `.claude/commands/mastermind.md`, `.claude/commands/monomind-mastermind.md`, `.claude/commands/monomind-monomind-mastermind.md`, and the six `.kimi-code/plugin/commands/*` mirrors. **Reality drift:** `.claude/commands/monomind-mastermind-master.md` and `.claude/commands/monomind-monomind-mastermind.md` do not exist in this worktree. The byte-identical copy with md5 `f38da0f2f19b1bbd0475c0b3a16aa4eb` actually lives at `.kimi-code/plugin/commands/{mastermind-master.md,monomind-mastermind-master.md}` and `.kimi-code/skills/{mastermind-master,monomind-mastermind-master}/SKILL.md` — fixed there instead. Content-searched (not path-trusted) for every real sibling containing the dangling-reference table and fixed all of them: `.claude/commands/mastermind/master.md`, the four `.kimi-code` mastermind-master mirrors (2 commands + 2 skills — six total was not accurate; four exist), `.claude/commands/mastermind.md` + `monomind-mastermind.md`, and the `.kimi-code` monomind-mastermind / monomind-monomind-mastermind skill+command mirrors.

### Step 1.5 — Propagate to the other four skill trees

- [x] After editing `.claude/skills/`, copy each edited file over its four siblings:

```bash
for f in mastermind-plan mastermind-execute mastermind-debug; do
  for t in .agents/skills .gemini/skills .kimi-code/skills packages/@monomind/cli/.claude/skills; do
    cp ".claude/skills/$f/SKILL.md" "$t/$f/SKILL.md"
  done
done
```

### Verification for Task 1

- [x] Run: (also fixed several dangling references this specific grep additionally caught outside the files named in Steps 1.1–1.4: mastermind-skill-builder/SKILL.md, performance-analysis/SKILL.md, verification-quality/SKILL.md — all synced across the five skill trees)

```bash
grep -rn 'mastermind-\(taskdev\|finish\|tdd\|verify\|build\|architect\|autodev\|approvev1\)' \
  .claude/skills .agents/skills .gemini/skills .kimi-code/skills \
  packages/@monomind/cli/.claude/skills .claude/commands .kimi-code/plugin/commands \
  2>/dev/null | grep -v '\.monomind/backups/'
```

**Expected output:** empty (exit code 1 from grep). Any line printed is a remaining dead reference.

- [x] Run `node scripts/lint-skills.mjs`. **Expected:** `✓ Skill lint passed — 0 errors, N warning(s)`. (Actual: `✓ Skill lint passed — 0 errors, 458 warning(s)`, exit 0.)

---

## Task 2 — Normalize the `<org>-issues.json` schema across all five skills

Edit the canonical `.claude/skills/` copy of each of the five skills, then sync to the other four trees (all five trees are currently byte-identical for these files, so a straight `cp` is correct).

### Step 2.1 — Add the shared normalization pass

- [x] In **`.claude/skills/mastermind-issues/SKILL.md`**, insert immediately after line 48 (the `limit="${limit:-50}"` line, closing the Step 1 bash block), a new block:

````markdown
Normalize any legacy records written by a pre-2.10 version of these skills. Idempotent — safe to run on every load.

```bash
python3 - "$issuesFile" <<'PYEOF'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
RENAME = {
    "assignee_id": "assigneeId", "assigned_to": "assigneeId",
    "created_at": "createdAt", "updated_at": "updatedAt",
    "closed_at": "closedAt", "project_id": "projectId",
    "parent_id": "parentId", "recovery_status": "recoveryStatus",
    "lastActivityAt": "updatedAt",
}
changed = False
for iss in data.get("issues", []):
    for old, new in RENAME.items():
        if old in iss:
            iss.setdefault(new, iss.pop(old))
            iss.pop(old, None)
            changed = True
    if iss.get("status") == "open":
        iss["status"] = "todo"
        changed = True
if changed:
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, indent=2)
    import os; os.replace(tmp, path)
PYEOF
```
````

- [x] Insert the identical block into the Step 1 load section of **`mastermind-issue-detail/SKILL.md`** (after line 65), **`mastermind-my-issues/SKILL.md`** (after line 41), and **`mastermind-liveness/SKILL.md`** (after line 65). In `mastermind-liveness`, guard it with `[ -f "$issuesFile" ] && ` because that skill tolerates a missing file.

### Step 2.2 — `mastermind-issues/SKILL.md`

- [x] Line 21 — replace `- \`status\`: open | in_progress | in_review | done | cancelled (filter)` with:

```markdown
- `status`: todo | in_progress | blocked | in_review | done | cancelled (filter)
```

- [x] Line 27 (after `limit`) — add a new input line:

```markdown
- `parent_id`: parent issue id, making the new issue a sub-issue (for create)
```

- [x] Line 85 — replace `        st    = iss.get("status","open")[:14]` with:

```python
        st    = iss.get("status","todo")[:14]
```

- [x] Replace the whole `### create` bash block (lines 136–158) with:

````markdown
```bash
[ -z "$title" ] && { echo "ERROR: --title required."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
newId="issue-$(python3 -c 'import time; print(int(time.time()*1000))')-001"

python3 - "$issuesFile" "$newId" "$title" "${description:-}" "${priority:-medium}" "${assignee:-}" "${workspace:-}" "${parent_id:-}" "$ts" <<'PYEOF'
import json, os, sys
path, iid, title, desc, pri, asgn, ws, parent, ts = sys.argv[1:]

VALID_PRIORITY = {"low","medium","high","urgent"}
if pri not in VALID_PRIORITY:
    print(f"ERROR: priority '{pri}' must be one of {sorted(VALID_PRIORITY)}.")
    sys.exit(1)

data = json.load(open(path))
issues = data.setdefault("issues", [])

if parent and not any(i.get("id") == parent for i in issues):
    print(f"ERROR: parent issue '{parent}' not found.")
    sys.exit(1)

issue = {
    "id": iid, "title": title, "description": desc,
    "status": "todo", "priority": pri,
    "assigneeId": asgn or None,
    "assigneeAgentId": None, "assigneeUserId": None,
    "parentId": parent or None,
    "projectId": None, "workspaceId": ws or None,
    "blockedByIssueIds": [],
    "createdAt": ts, "updatedAt": ts,
}
issues.append(issue)
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
print(f"  Created: {iid}")
print(f"  Title:   {title}")
print(f"  Status:  todo  |  Priority: {pri}" + (f"  |  Parent: {parent}" if parent else ""))
PYEOF
```
````

- [x] In the `### update` block, replace lines 167–188 with a version that validates the status enum and writes atomically:

````markdown
```bash
[ -z "$issue_id" ] && { echo "ERROR: --issue-id required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$issue_id" "${status:-}" "${priority:-}" "${title:-}" "$ts" <<'PYEOF'
import json, os, sys
path, iid, new_st, new_pri, new_title, ts = sys.argv[1:]

VALID_STATUS   = {"todo","in_progress","blocked","in_review","done","cancelled"}
VALID_PRIORITY = {"low","medium","high","urgent"}
if new_st and new_st not in VALID_STATUS:
    print(f"ERROR: status '{new_st}' must be one of {sorted(VALID_STATUS)}.")
    sys.exit(1)
if new_pri and new_pri not in VALID_PRIORITY:
    print(f"ERROR: priority '{new_pri}' must be one of {sorted(VALID_PRIORITY)}.")
    sys.exit(1)

data = json.load(open(path))
issues = data.get("issues", [])
found = False
for iss in issues:
    if iss.get("id") == iid:
        if new_st:    iss["status"] = new_st
        if new_pri:   iss["priority"] = new_pri
        if new_title: iss["title"] = new_title
        iss["updatedAt"] = ts
        found = True
        break
if not found:
    print(f"ERROR: Issue '{iid}' not found.")
    sys.exit(1)
data["issues"] = issues
tmp = path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, path)
print(f"  Updated: {iid}  (updatedAt: {ts})")
PYEOF
```
````

- [x] In the `### close` block, change the in-place `with open(path, "w")` at lines 214–215 to the same `tmp` + `os.replace` pattern (add `import os` to line 198's import list).

### Step 2.3 — `mastermind-issue-detail/SKILL.md`

- [x] Lines 30–36, the status-flow diagram — replace with:

```
todo → in_progress → in_review → done
         ↓
      blocked → in_progress
         ↓
    cancelled
```

- [x] Line 55 — replace `Create tasks via /mastermind:tasks.` with `Create issues via /mastermind:issues --action create.`
- [x] Lines 82–85 (the `show` jq filter) — replace:

```
  "  Assignee:      \(.assignee_id // "(unassigned)")",
  "  Project:       \(.project_id // "(none)")",
  "  Created:       \(.created_at // "-")",
  "  Updated:       \(.updated_at // "-")"
```

with:

```
  "  Assignee:      \(.assigneeId // "(unassigned)")",
  "  Agent:         \(.assigneeAgentId // "(none)")",
  "  Project:       \(.projectId // "(none)")",
  "  Created:       \(.createdAt // "-")",
  "  Updated:       \(.updatedAt // "-")"
```

- [x] Line 79 — replace `"  Status:        \(.status // "open")",` with `"  Status:        \(.status // "todo")",`
- [x] Line 89 — replace `select(.parent_id == $pid)` with `select(.parentId == $pid)`
- [x] Line 97 — replace `.recovery_status // "none"` with `.recoveryStatus // "none"`
- [x] Line 172 — replace `select(.parent_id == $pid)` with `select(.parentId == $pid)`
- [x] Line 173 — replace `(.status // "open")` with `(.status // "todo")`
- [x] Line 180 — replace the footer with:

```bash
echo "To create a sub-issue: /mastermind:issues --org $org_name --action create --title '<title>' --parent-id $issue_id"
```

- [x] Lines 223–225 (the `assign` jq) — replace with:

```bash
jq --arg id "$resolvedId" --arg ag "$assignee_id" --arg ts "$ts" \
  '.issues = [(.issues // [])[] | if .id == $id then .assigneeId = $ag | .assigneeAgentId = $ag | .assigneeUserId = null | .updatedAt = $ts else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"
```

- [x] Lines 235–237 (the `close` jq) — replace `.updated_at = $ts | .closed_at = $ts` with `.updatedAt = $ts | .closedAt = $ts`
- [x] Lines 246–248 (the `reopen` jq) — replace `.status = "open" | .updated_at = $ts | .closed_at = null` with `.status = "todo" | .updatedAt = $ts | .closedAt = null`
- [x] Lines 264–268 (the `recover` jq) — replace `.recovery_status = $ra | .updated_at = $ts` with `.recoveryStatus = $ra | .updatedAt = $ts`

### Step 2.4 — `mastermind-my-issues/SKILL.md`

- [x] Line 19 — replace `- \`status_filter\`: open | in_progress | all (default: open+in_progress)` with:

```markdown
- `status_filter`: active | todo | in_progress | blocked | in_review | done | cancelled | all (default: active = todo+in_progress)
```

- [x] Lines 57–66 (the `list` jq) — replace with:

```bash
jq -r --arg uid "$assigneeFilter" --arg sf "$statusFilter" '
  (.issues // [])[] |
  select(
    (.assigneeId == $uid) and
    (if $sf == "active" then (.status == "todo" or .status == "in_progress")
     elif $sf == "all" then true
     else .status == $sf
     end)
  ) |
  [.id, (.status // "todo"), (.priority // "medium"), (.title // "(no title)")] | @tsv
' "$issuesFile" | while IFS=$'\t' read -r id st pri title; do
```

- [x] Lines 71–73 — replace the total count filter with:

```bash
total=$(jq -r --arg uid "$assigneeFilter" \
  '[(.issues // [])[] | select(.assigneeId == $uid)] | length' \
  "$issuesFile")
```

- [x] Lines 89–93 (`assign-self`) — replace with the human-ownership form. **This is the fix for the human-audited-as-agent bug:**

```bash
jq --arg id "$issue_id" --arg uid "$assigneeFilter" --arg ts "$ts" \
  '.issues = [(.issues // [])[] | if .id == $id then
     .assigneeId = $uid | .assigneeUserId = $uid | .assigneeAgentId = null | .updatedAt = $ts
   else . end]' \
  "$issuesFile" > "$tmp" && mv "$tmp" "$issuesFile"
```

- [x] Lines 105–109 (`unassign`) — replace `.assigneeId = null | .lastActivityAt = $ts` with `.assigneeId = null | .assigneeUserId = null | .assigneeAgentId = null | .updatedAt = $ts`
- [x] Lines 121–125 (`close`) — replace `.status = "done" | .closedAt = $ts | .lastActivityAt = $ts` with `.status = "done" | .closedAt = $ts | .updatedAt = $ts`

### Step 2.5 — `mastermind-liveness/SKILL.md` — rewrite the `check` audit loop

- [x] Replace lines 109–171 (from `for iss in issues:` through the final `healthy.append((iid, title, status, "no agent assignee"))`) with:

```python
for iss in issues:
    status = iss.get("status","")
    iid    = iss.get("id","?")
    title  = (iss.get("title") or "?")[:50]

    if status in terminal_statuses:
        continue
    if status not in non_terminal_statuses:
        # Silently skipping an unknown status is how issues become invisible.
        warnings.append((iid, title, status, f"unknown status '{status}' — outside the canonical vocabulary"))
        continue

    aId = iss.get("assigneeAgentId")
    uId = iss.get("assigneeUserId")

    # Human-owned: the next move belongs to a person, not an execution path.
    if uId and not aId:
        healthy.append((iid, title, status, "user-owned"))
        continue

    paths = []

    run_id = iss.get("executionRunId") or iss.get("checkoutRunId")
    if run_id and run_id in active_runs:
        paths.append("active-run")

    resolved_ids = {i.get("id") for i in issues if i.get("status") in terminal_statuses}
    blockers = iss.get("blockedByIssueIds") or []
    if status == "blocked":
        if blockers:
            unresolved = [b for b in blockers if b not in resolved_ids]
            if unresolved:
                paths.append(f"blocked-by:{','.join(unresolved[:2])}")
            else:
                warnings.append((iid, title, status, "all blockers resolved but issue still blocked"))
        elif not iss.get("recoveryActions"):
            # Liveness Contract: blocked requires a named dependency or an
            # explicit human decision. This issue records neither.
            stalled.append((iid, title, status, "blocked with no blockedByIssueIds and no recovery action"))
            continue

    if iss.get("executionPolicy", {}).get("monitor", {}).get("nextCheckAt"):
        paths.append("monitor")

    if iss.get("recoveryActions") and any(
        r.get("status") not in ("resolved","cancelled")
        for r in iss.get("recoveryActions",[])
    ):
        paths.append("recovery-action")

    if iss.get("currentParticipant"):
        paths.append("participant")

    if status == "in_review" and not (iss.get("reviewerId") or iss.get("currentParticipant")):
        stalled.append((iid, title, status, "in_review with no named reviewer"))
        continue

    if status == "in_progress" and aId and not paths:
        updated = iss.get("updatedAt","")
        if updated:
            try:
                age = now - datetime.fromisoformat(updated[:19])
                if age > timedelta(hours=2):
                    stalled.append((iid, title, status, f"in_progress {int(age.total_seconds()//3600)}h with no active path"))
                    continue
            except Exception:
                pass
        stalled.append((iid, title, status, "in_progress with no active execution path"))
        continue

    if paths:
        healthy.append((iid, title, status, " + ".join(paths)))
    elif not aId:
        warnings.append((iid, title, status, "no assignee — nothing will pick this up"))
    elif status == "todo":
        warnings.append((iid, title, status, "todo assigned to agent — may need wakeup"))
    else:
        stalled.append((iid, title, status, f"{status} with an agent assignee but no execution path"))
```

This single replacement fixes four defects: the universal `else: healthy` fallthrough that mislabeled genuinely stalled issues; the misleading `"no agent assignee"` reason printed even for assigned issues; the `blocked`-with-no-blockers hole (exactly the state Task 3's plan-to-tasks previously produced); and the `KeyError` from `{i["id"] for i in issues}` at old line 134.

- [x] Line 299 (`wakeup` action) — replace `checkout_agent = iss.get("assigneeAgentId") or iss.get("assigneeId","")` with:

```python
checkout_agent = iss.get("assigneeAgentId") or ""
```

- [x] Lines 226–228 (`checkout`) — after `iss["assigneeAgentId"]= agentId`, add `iss["assigneeUserId"] = None` so checkout transfers ownership cleanly.
- [x] In `checkout`, `release`, and `recover`, replace each in-place `with open(path, "w")` with the `tmp` + `os.replace(tmp, path)` pattern (each block already imports `sys`; add `os`).

### Step 2.6 — Sync to the other four trees

- [x] Run:

```bash
for f in mastermind-issues mastermind-issue-detail mastermind-my-issues mastermind-liveness; do
  for t in .agents/skills .gemini/skills .kimi-code/skills packages/@monomind/cli/.claude/skills; do
    cp ".claude/skills/$f/SKILL.md" "$t/$f/SKILL.md"
  done
done
```

### Verification for Task 2

- [x] **No retired spelling survives anywhere:**

```bash
grep -rn 'assignee_id\|assigned_to\|created_at\|updated_at\|closed_at\|project_id\|parent_id\|recovery_status\|lastActivityAt' \
  .claude/skills/mastermind-issues .claude/skills/mastermind-issue-detail \
  .claude/skills/mastermind-my-issues .claude/skills/mastermind-liveness \
  .claude/skills/mastermind-plan-to-tasks
```

**Expected:** only the two intentional survivors — the `parent_id` *input name* in `mastermind-issues/SKILL.md` (a CLI flag, not a JSON key) and the `RENAME` map inside the Task 2.1 normalization block. Any other hit is an unconverted read/write site.

- [x] **End-to-end round trip.** This is the concrete failure the review described; it must now pass:

```bash
mkdir -p .monomind/orgs && printf '{"name":"t","goal":"g","roles":[{"id":"a1","title":"Agent One"}]}' > .monomind/orgs/t.json
echo '{"issues":[]}' > .monomind/orgs/t-issues.json
# create → assign via issue-detail → confirm my-issues and liveness both see it
```

Follow the three skills' create → `--action assign --assignee-id a1` → `my-issues --assignee-id a1` → `liveness --action check` sequence. **Expected:** `my-issues` lists the issue (previously it did not, because `issue-detail` wrote `assignee_id`), and `liveness check` reports it under Warnings as `todo assigned to agent — may need wakeup` rather than skipping it entirely.

- [x] Clean up: `rm .monomind/orgs/t.json .monomind/orgs/t-issues.json`
- [x] `node scripts/lint-skills.mjs` → `✓ Skill lint passed`

---

## Task 3 — Give `mastermind-plan-to-tasks` a real Step 4

Step 4 (lines 92–117) currently seeds `{"issues":[]}` and then contains only comments — `# (issue creation happens inline above as each issue is decomposed)`. Nothing appends a record, generates an id, or resolves `blockedBy:<title>` into `blockedByIssueIds`. The skill's headline feature has no executable contract.

**Sequenced after Task 2 deliberately:** Step 4 must emit the canonical schema. Writing it against the old field names would guarantee rework.

### Step 3.1 — Restructure Step 3's output contract

- [x] In `.claude/skills/mastermind-plan-to-tasks/SKILL.md`, replace the "Decomposition output" fenced block (lines 73–80) with:

````markdown
For each issue extracted from the plan, emit one object into a JSON array and write the
whole array to `.monomind/orgs/<org_name>-plan-decomposition.json` using the Write tool:

```json
[
  {
    "title": "Short imperative deliverable name",
    "description": "1-2 sentence summary of the deliverable",
    "assignee": "<agent-id from the org roster, or null if unassigned>",
    "priority": "low | medium | high | urgent",
    "blockedBy": ["<exact title of a blocking issue in this same array>"]
  }
]
```

Titles must be unique within the array — `blockedBy` is resolved by exact title match.
Use `[]` for `blockedBy` when an issue has no blockers.
````

### Step 3.2 — Replace Step 4 with a real resolver

- [x] Replace the entire `## Step 4 — Create Issues (unless dry_run=true)` section (lines 92–117) with:

````markdown
## Step 4 — Create Issues (unless dry_run=true)

Reads the decomposition written in Step 3, assigns collision-free ids, validates assignees
against the org roster, resolves `blockedBy` titles into `blockedByIssueIds`, and appends
to the issues file atomically. Fails loudly on any unresolved or ambiguous reference —
an unresolved blocker silently dropped is exactly what produces a `blocked` issue with an
empty `blockedByIssueIds`, which `mastermind-liveness` reports as stalled.

```bash
issuesFile=".monomind/orgs/${org_name}-issues.json"
decompFile=".monomind/orgs/${org_name}-plan-decomposition.json"
[ ! -f "$issuesFile" ] && echo '{"issues":[]}' > "$issuesFile"
[ ! -f "$decompFile" ] && { echo "ERROR: $decompFile not found — Step 3 must write it first."; exit 1; }

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$issuesFile" "$decompFile" "$orgFile" "${project_id:-}" "${workspace_id:-}" "${dry_run:-false}" "$ts" <<'PYEOF'
import json, os, sys, time

issues_path, decomp_path, org_path, project_id, workspace_id, dry_run, ts = sys.argv[1:]
dry = dry_run == "true"

VALID_PRIORITY = {"low", "medium", "high", "urgent"}

decomp = json.load(open(decomp_path))
if not isinstance(decomp, list) or not decomp:
    print("ERROR: decomposition must be a non-empty JSON array.")
    sys.exit(1)

roster = {r.get("id") for r in json.load(open(org_path)).get("roles", [])}
data   = json.load(open(issues_path))
issues = data.setdefault("issues", [])

# --- Validate before mutating anything ---
errors, titles = [], {}
for n, item in enumerate(decomp, 1):
    title = (item.get("title") or "").strip()
    if not title:
        errors.append(f"item {n}: missing title")
        continue
    if title in titles:
        errors.append(f"item {n}: duplicate title {title!r} — titles must be unique to resolve blockedBy")
    titles[title] = None
    pri = item.get("priority") or "medium"
    if pri not in VALID_PRIORITY:
        errors.append(f"{title!r}: priority {pri!r} must be one of {sorted(VALID_PRIORITY)}")
    asgn = item.get("assignee")
    if asgn and asgn not in roster:
        errors.append(f"{title!r}: assignee {asgn!r} is not a role in this org (roster: {sorted(roster)})")

existing_by_title = {i.get("title"): i.get("id") for i in issues}
for item in decomp:
    for b in item.get("blockedBy") or []:
        if b not in titles and b not in existing_by_title:
            errors.append(f"{item.get('title')!r}: blockedBy {b!r} matches no issue in this batch or in the existing file")

if errors:
    print("ERROR: decomposition did not validate — no issues were created.")
    for e in errors:
        print(f"  · {e}")
    sys.exit(1)

# --- Assign ids (batch-stable, collision-free) ---
batch = int(time.time() * 1000)
for n, item in enumerate(decomp, 1):
    titles[item["title"].strip()] = f"issue-{batch}-{n:03d}"

def resolve(t):
    return titles.get(t) or existing_by_title[t]

created = []
for item in decomp:
    title = item["title"].strip()
    created.append({
        "id": titles[title],
        "title": title,
        "description": item.get("description") or "",
        "status": "todo",
        "priority": item.get("priority") or "medium",
        "assigneeId": item.get("assignee") or None,
        "assigneeAgentId": item.get("assignee") or None,
        "assigneeUserId": None,
        "parentId": None,
        "projectId": project_id or None,
        "workspaceId": workspace_id or None,
        "blockedByIssueIds": [resolve(b) for b in (item.get("blockedBy") or [])],
        "createdAt": ts,
        "updatedAt": ts,
    })

if dry:
    print("DRY RUN — no issues were created. Would create:")
    for c in created:
        blockers = ", ".join(c["blockedByIssueIds"]) or "none"
        print(f"  {c['id']}  [{c['priority']:<6}] {c['title']}")
        print(f"      assignee: {c['assigneeId'] or 'UNASSIGNED'}   blockedBy: {blockers}")
    print(f"\n  {len(created)} issue(s) would be created.")
    sys.exit(0)

issues.extend(created)
tmp = issues_path + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, indent=2)
os.replace(tmp, issues_path)

print("CREATED ISSUES:")
for c in created:
    blockers = ", ".join(c["blockedByIssueIds"]) or "none"
    print(f"  {c['id']}  [{c['priority']:<6}] {c['title']}")
    print(f"      assignee: {c['assigneeId'] or 'UNASSIGNED'}   blockedBy: {blockers}")
print(f"\n  {len(created)} issue(s) created in {issues_path}")

roots = [c for c in created if not c["blockedByIssueIds"]]
print(f"  {len(roots)} issue(s) are unblocked and can start in parallel.")
PYEOF

rm -f "$decompFile"
```

> **These issues are not auto-consumed by the org runtime.** `OrgDaemon` builds its `TaskDag`
> fresh in memory on every start and never reads `<org>-issues.json` (verified: zero references
> in `packages/@monomind/cli/src/orgrt/`). Issues created here are tracked by the
> `mastermind-issues` / `mastermind-my-issues` / `mastermind-liveness` skills and shown in the
> dashboard, but running `monomind org run <org>` will not pick them up. Drive execution from
> this file with `mastermind-execute`, or pass work explicitly via `org run --task`.
````

- [x] Sync to the other four trees (same `cp` loop as Step 2.6, for `mastermind-plan-to-tasks`).

### Verification for Task 3

- [x] Build a fixture and run the resolver's happy path and both failure paths:

```bash
mkdir -p .monomind/orgs
printf '{"name":"t","goal":"g","roles":[{"id":"a1","title":"One"},{"id":"a2","title":"Two"}]}' > .monomind/orgs/t.json
echo '{"issues":[]}' > .monomind/orgs/t-issues.json
cat > .monomind/orgs/t-plan-decomposition.json <<'EOF'
[
  {"title":"Design schema","description":"d","assignee":"a1","priority":"high","blockedBy":[]},
  {"title":"Implement writer","description":"d","assignee":"a2","priority":"medium","blockedBy":["Design schema"]}
]
EOF
```

Run the Step 4 block with `dry_run=true`. **Expected:** two issues listed, `Implement writer` showing `blockedBy: issue-<ms>-001`, and `1 issue(s) are unblocked and can start in parallel.` — with `.monomind/orgs/t-issues.json` still containing `{"issues":[]}`.

- [x] Now the failure paths. Change `"assignee":"a2"` to `"assignee":"nobody"` and re-run. **Expected:** exit 1 with `· 'Implement writer': assignee 'nobody' is not a role in this org (roster: ['a1', 'a2'])` and **no** mutation of the issues file. Then restore the assignee, change `blockedBy` to `["Design schmea"]` (typo) and re-run. **Expected:** exit 1 with `blockedBy 'Design schmea' matches no issue in this batch or in the existing file`.
- [x] Run once with `dry_run=false`, then confirm the liveness audit is clean:

```bash
jq '.issues | length' .monomind/orgs/t-issues.json   # expected: 2
jq -r '.issues[] | "\(.id) \(.status) \(.blockedByIssueIds | join(","))"' .monomind/orgs/t-issues.json
```

**Expected:** both statuses `todo`, and the second issue's `blockedByIssueIds` naming the first issue's real id (never a title).

- [x] Clean up: `rm -f .monomind/orgs/t.json .monomind/orgs/t-issues.json .monomind/orgs/t-plan-decomposition.json`

---

## Task 4 — Close the sub-issue dead end

`mastermind-issue-detail`'s `sub-issues` action filters on `parentId`, but before Task 2 no code path anywhere could produce an issue with that field set. Its footer directed users to `/mastermind:tasks --action create --parent-id`, and `mastermind-tasks` does accept `parent_id` (line 22) — but routes it to `monotask card subtask add` (line 91), i.e. into a SQLite board, not into the issues sidecar. The `--parent-id` parameter and the corrected footer were both added in Task 2 (Steps 2.2 and 2.3); this task verifies the loop closes and removes the remaining misdirection.

### Step 4.1 — Remove the cross-store misdirection from `mastermind-tasks`

- [x] In `.claude/skills/mastermind-tasks/SKILL.md`, add immediately after the frontmatter (line 7) a scope banner:

```markdown
> **LEGACY-ORG-V1 — writes to a monotask board, not to `<org>-issues.json`.** This skill's
> `parent_id`, `status` (`todo | doing | done`), and card model belong to the pre-v2
> board-backed runner. For v2 issue tracking — including sub-issues — use
> `/mastermind:issues --action create --parent-id <id>`.
```

### Verification for Task 4

- [x] Create a parent and a child, then confirm `sub-issues` finds it:

```bash
printf '{"name":"t","goal":"g","roles":[{"id":"a1","title":"One"}]}' > .monomind/orgs/t.json
echo '{"issues":[]}' > .monomind/orgs/t-issues.json
```

Run `mastermind-issues --action create --title 'Parent'`, note the printed id, then `mastermind-issues --action create --title 'Child' --parent-id <that id>`, then `mastermind-issue-detail --issue-id <that id> --action sub-issues`.

**Expected:** the `sub-issues` table lists exactly one row for `Child` with status `todo`, and the footer reads `To create a sub-issue: /mastermind:issues --org t --action create --title '<title>' --parent-id <id>`. Also confirm the guard fires: `--action create --title 'Orphan' --parent-id issue-does-not-exist` **must** exit 1 with `ERROR: parent issue 'issue-does-not-exist' not found.`

- [x] Clean up the fixture files.

---

## Task 5 — Write `<org>-activity.jsonl` so its seven readers stop reading an empty file

Verified: **zero writers repo-wide.** Grep for `activity.jsonl` / `-activity` / `appendActivity` across `packages/@monomind/cli/src` and every skill tree finds no `appendFileSync`, `>>`, `tee`, or `writeFile` site. Readers: `mastermind-activity:54`, `mastermind-diagnose:50`, `mastermind-agent-detail:44`, `mastermind-issue-detail:61`, `mastermind-export:44,107,151`, `mastermind-profile:143`, `mastermind-orgstatus:195`, plus `packages/@monomind/cli/src/ui/routes-org.mjs:1063` (the dashboard's 7-day success rate, which swallows the ENOENT in a bare `try{}catch(_){}`). Every reader is permanently in its "no activity yet" branch.

**Scope decision:** write the appender in the skills that already own issue state transitions, not in `OrgDaemon`. The daemon has its own event streams (`-state.json`, `-threads.jsonl`, checkpoints) and does not know about issues at all (Task 7). Making the file-based tracker log its own transitions is the small, correct fix; making the daemon log into a file it never reads would be inventing a coupling.

### Step 5.1 — Add the appender to every issue state transition

- [x] In `.claude/skills/mastermind-issues/SKILL.md`, add a new section between Step 2 and Step 3:

````markdown
## Step 2.5 — Append Activity Record

After any `create`, `update`, or `close` action succeeds, append one line to the org's
activity log. This is the only writer for `<org>-activity.jsonl`; seven skills read it.

```bash
activityFile=".monomind/orgs/${org_name}-activity.jsonl"
jq -cn \
  --arg iid "${affected_issue_id}" \
  --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg st "${resulting_status}" \
  --arg ag "${assignee:-operator}" \
  --arg sm "${action} ${affected_issue_id}" \
  '{issue_id:$iid, ts:$ts, status:$st, tokens:null, agent:$ag, type:$action, summary:$sm}' \
  >> "$activityFile"
```

`affected_issue_id` is `$newId` for `create` and `$issue_id` for `update`/`close`;
`resulting_status` is `todo`, the new status, or `done` respectively.
````

- [x] Add the equivalent block to `mastermind-issue-detail` (after `assign`, `close`, `reopen`, `recover`) and to `mastermind-liveness` (after `checkout`, `release`, `recover`), using each skill's own `$resolvedId` / `$issue_id` and `$agent_id`.
- [x] Sync all three to the other four trees.

### Verification for Task 5

- [x] After a create + assign + close sequence on a fixture org:

```bash
wc -l < .monomind/orgs/t-activity.jsonl          # expected: 3
jq -r '.type + " " + .issue_id + " -> " + .status' .monomind/orgs/t-activity.jsonl
```

**Expected:** three lines reading `create … -> todo`, `assign … -> todo`, `close … -> done`.

- [x] Confirm a consumer now renders it: run `mastermind-issue-detail --issue-id <id> --action runs`. **Expected:** a populated table rather than `No runs found in the last 14 days.`
- [x] Every line must be valid JSON: `jq -e . .monomind/orgs/t-activity.jsonl > /dev/null && echo OK` → `OK`.

---

## Task 6 — Collapse the routers and repair the memory tool names

### Step 6.1 — Fix the two genuinely-missing MCP tools in `mastermind-protocol`

Eight of the ten tools this file calls are correctly registered. Only two are not.

- [x] In `.claude/skills/mastermind-protocol/SKILL.md` line 85, replace `mcp__monomind__memory_stats` with `mcp__monomind__memory_health` (registered at `packages/@monomind/cli/src/mcp-tools/memory-tools.ts:39`; `memory_stats` is a **CLI** subcommand — `monomind memory stats` — with no MCP tool).
- [x] Line 97, replace `mcp__monomind__monograph_add_fact` with `mcp__monomind__memory_kg_ingest` (registered; it is the tool that adds entities and relations).
- [x] Line 33, replace `If it returns \`"LanceDB bridge not available"\` or any error, fall back to:` with `If it returns an error, fall back to:` — LanceDB was fully removed (`CLAUDE.local.md`; commits `031cb843f`, `b670e65c3`).
- [x] Line 77, replace `If LanceDB is unavailable, fall back to` with `If hierarchical storage is unavailable, fall back to`.

### Step 6.2 — Rewrite `.claude/commands/mastermind-brain.md`

Ten of thirteen tool calls use the removed `lancedb_*` prefix (lines 18, 19, 20, 46, 48, 60, 70, 71, 72, 82). `grep -rn 'lancedb_' packages/@monomind/cli/src` returns **zero hits** — every one is dead.

- [x] Apply `s/mcp__monomind__lancedb_/mcp__monomind__memory_/g` across the file. This resolves all ten to registered tools (`memory_health`, `memory_hierarchical-recall`, `memory_hierarchical-store`, `memory_pattern-search`).
- [x] Line 61 — replace `add \`EXCEPTION\` edge via \`mcp__monomind__monograph_add_fact\`` with `add the exception relation via \`mcp__monomind__memory_kg_ingest\``.
- [x] Lines 95–96 — `mcp__monomind__memory_delete` is not a registered MCP tool, but `monomind memory delete` **is** a real CLI subcommand (confirmed via `node packages/@monomind/cli/bin/cli.js memory --help`). Replace both lines with the CLI form:

```markdown
1. Delete all Tier 1 entries: `npx monomind@latest memory delete --namespace mastermind:<domain>:raw`
2. Delete all Tier 2 entries: `npx monomind@latest memory delete --namespace mastermind:<domain>:weekly`
```

- [x] Line 5 — replace `(LanceDB + Monograph)` with `(memory store + Monograph)`.

### Step 6.3 — Fix `master.md`'s stale LanceDB Brain Load

- [x] In `.claude/commands/mastermind-master.md`, replace line 299's `mcp__monomind__lancedb_hierarchical-recall` with `mcp__monomind__memory_hierarchical-recall` and line 300's `mcp__monomind__lancedb_context-synthesize` with `mcp__monomind__memory_context-synthesize` — matching `mastermind-protocol/SKILL.md` lines 32 and 37. (Actual line numbers had drifted to ~298/299 by this point due to Task 1's row deletions; located by quoted text.)
- [x] Lines 189 and 938 — replace the prose `LanceDB` with `the memory store`. (Drifted to ~188/937; located by quoted text.)
- [x] Apply the same edits to the sibling copies listed in Step 1.4.

### Step 6.4 — Collapse the two routers

`.claude/skills/mastermind/SKILL.md` is 36 lines containing **two hand-written variants of the same router** stitched by `# monomind:start skills:claude:mastermind` (line 22) / `# monomind:end` (line 36) — lines 6–21 and 23–35 say the same thing in different words. Neither variant mentions `mastermind-design`, `mastermind-idea`, or `mastermind-intake`, so an agent that reaches this router instead of `mastermind-master.md` silently bypasses the Design Gate.

- [x] Replace the entire file with:

```markdown
---
name: mastermind
description: Use when a request may need a Mastermind workflow such as planning, review, debugging, research, execution, organization work, or memory.
---

# Mastermind Router

Load only the workflow that matches the request:

- `mastermind-idea` to shape a raw prompt into a stated problem and options.
- `mastermind-design` before building a feature — this is a gate, not a suggestion.
- `mastermind-plan` before multi-file implementation.
- `mastermind-execute` for a written plan.
- `mastermind-review` for audits and critiques.
- `mastermind-debug` for failures or unexpected behavior.
- `mastermind-research` for open questions.
- `mastermind-org` for organization lifecycle work.
- `mastermind-memory` for persistent knowledge.

**For build/feature work, the gates are mandatory and ordered:** idea → design → plan →
execute → review. The full routing table for the other 20+ Mastermind workflows lives in
`.claude/commands/mastermind-master.md`; consult it before concluding that no workflow applies.

Use Monograph before broad repository search when the platform exposes the
Monomind MCP server. Without native skills, run
`monomind mastermind run <skill> --print` and follow the printed procedure.
Platform tool mappings are in [references/](references/).
```

- [x] Sync to the other four trees.

### Verification for Task 6

- [x] **No dead tool name survives:** (empty within the mastermind pipeline surface; residual hits from this grep's broader `.claude/commands` sweep are in unrelated automation-session-memory.md / monitoring-status.md / memory/README.md / monitoring/README.md — a different, pre-existing subsystem outside this plan's scope, left untouched)

```bash
grep -rn 'lancedb_\|memory_stats\|monograph_add_fact\|memory_delete' \
  .claude/skills .claude/commands .agents/skills .gemini/skills .kimi-code/skills \
  packages/@monomind/cli/.claude/skills 2>/dev/null | grep -v '\.monomind/backups/'
```

**Expected:** empty.

- [x] **Every remaining `mcp__monomind__` name in the mastermind surface is registered.** Cross-check against the live registry: (also found and fixed `monograph_bridge` in mastermind-techport/SKILL.md, not registered — replaced with `monograph_surprises`, and `swarm_init/status/health/shutdown` in mastermind-monoswarm.md and mastermind-help.md — replaced with the registered `monoswarm_*` prefix)

```bash
grep -rhoE 'mcp__monomind__[a-z_-]+' .claude/skills/mastermind*/SKILL.md .claude/commands/mastermind*.md \
  | sort -u > /tmp/claude-1000/-home-monoes-Desktop-monoes-repos-monomind/91a323ea-a6c9-4a08-9f25-fd154085a01b/scratchpad/referenced-tools.txt
```

Compare each against the tool names exported from `packages/@monomind/cli/src/mcp-tools/`. **Expected:** every referenced name appears in the registry.

- [x] `.claude/skills/mastermind/SKILL.md` no longer contains `monomind:start`:

```bash
grep -c 'monomind:start' .claude/skills/mastermind/SKILL.md
```

**Expected:** `0`.

- [x] `node scripts/lint-skills.mjs` → `✓ Skill lint passed` (actual: `✓ Skill lint passed — 0 errors, 458 warning(s)`, exit 0)

---

## Task 7 — Runtime honesty: fix resume, fix the crash checkpoint, document the severance

This replaces the review's Top-5 item #4 (build the issues↔TaskDag bridge). See "why the bridge should NOT be built now" above.

### Step 7.1 — Rehydrate the TaskDag on resume

`packages/@monomind/cli/src/orgrt/daemon.ts:1208` is the `{ resume: true }` branch and constructs a bare `new TaskDag()`, identical to the fresh-start branch at `:1222`. `TaskDag.fromJSON` (`task-dag.ts:263`) is never called anywhere in `src/`. Every resume discards all task state.

- [x] At `daemon.ts:1208`, replace `running.taskDag = new TaskDag();` with a rehydration from the persisted checkpoint. Read the surrounding block first to establish the exact name of the checkpoint variable in scope, then restore via `TaskDag.fromJSON(<checkpoint>.tasks)` when tasks are present, falling back to `new TaskDag()` when they are not.
- [x] Ensure `captureCheckpoint()` serializes the DAG via `taskDag.toJSON()` (`task-dag.ts:259`) so there is something to rehydrate. Verify whether it already does before adding it.

### Step 7.2 — Stop the crash handler from destroying the only resumable state

`persistState()` (`daemon.ts:1674-1716`) writes `...(checkpoint ? { checkpoint } : {})` at line 1713. `persistCrashStateAll()` (`daemon.ts:1723-1741`) does a full-file `writeJsonFileAtomic` at 1729–1736 with **no `checkpoint` key at all**. `resumeOrg()` (`checkpoint-ops.ts:118`) hard-requires `rt?.checkpoint` and returns `null` otherwise — so the handler that exists to make recovery possible is the thing that prevents it.

- [x] In `persistCrashStateAll()`, capture a checkpoint for each org still in `this.orgs` before writing, and include it in the payload:

```ts
...(checkpoint ? { checkpoint } : {}),
```

mirroring line 1713. Reuse `captureCheckpoint(org, 'crashed')` rather than inlining a second capture path.

- [x] Do **not** add periodic mid-run checkpointing in this task. It is a separate change with its own I/O-frequency tradeoff; the crash-path data loss is the bug being fixed here.

### Step 7.3 — State the severance in the skills that imply a handoff

- [x] Add the "not auto-consumed" note to `mastermind-issues/SKILL.md` (after Step 1) using the same wording added to `mastermind-plan-to-tasks` in Task 3.2.
- [x] In `mastermind-runorg` and `mastermind-org`, add one line to the inputs section: `The org runtime does not read <org>-issues.json. Work is driven by the org definition's roles and goal plus an optional --task string.`

### Verification for Task 7

- [x] Build must stay green (`tsc` is the typecheck in this package):

```bash
pnpm --filter @monoes/monomindcli run build
```

**Expected:** exits 0 with no TypeScript errors.

- [x] Run the orgrt suite:

```bash
pnpm --filter @monoes/monomindcli exec vitest run __tests__/orgrt/
```

**Expected:** all tests pass. If no test covers resume, add one asserting that an org resumed from a checkpoint containing two tasks has `taskDag.all().length === 2` — the current code returns `0`.

- [x] Confirm the crash path now writes a checkpoint:

```bash
grep -n 'checkpoint' packages/@monomind/cli/src/orgrt/daemon.ts | sed -n '/17[0-4][0-9]/p'
```

**Expected:** a `checkpoint` key inside the `persistCrashStateAll` payload (previously absent between lines 1723 and 1741).

---

## Task 8 — Wire the skill linter into CI so none of this silently re-rots

Nothing in CI reads a `SKILL.md` today. `scripts/lint-skills.mjs` exists, is functional, and is invoked by no script and no workflow. Every fix in Tasks 0–7 is a one-time cleanup until this task makes it a gate.

### Step 8.1 — Add a dangling-`Skill()`-reference check

- [x] In `scripts/lint-skills.mjs`, extend `SKILL_TREES` (lines 15–18) to all five trees:

```js
const SKILL_TREES = [
  join(ROOT, '.claude/skills'),
  join(ROOT, '.agents/skills'),
  join(ROOT, '.gemini/skills'),
  join(ROOT, '.kimi-code/skills'),
  join(ROOT, 'packages/@monomind/cli/.claude/skills'),
];
```

- [x] Add a check that every `Skill("mastermind-…")` reference resolves. Insert after the `@alpha` check inside `lintTree` (after line 96):

```js
    // Every Skill("mastermind-x") reference must name a real skill package.
    for (const m of content.matchAll(/Skill\(["']([\w-]+)["']\)/g)) {
      if (!KNOWN_SKILLS.has(m[1])) {
        errors.push(
          `[${label}] ${skill}/SKILL.md: Skill("${m[1]}") does not exist in any skill tree`,
        );
      }
    }
```

with `KNOWN_SKILLS` built once before `lintTree` runs, as the union of directory names across all five trees.

### Step 8.2 — Add a self-duplication detector

- [x] Add to `lintTree`, guarding against exactly the Task 0 corruption:

```js
    // A SKILL.md must never contain its own body twice (managed-block append bug).
    const body = content.replace(/^---\n[\s\S]*?\n---\n/, '');
    const half = body.slice(0, Math.floor(body.length / 2)).trimEnd();
    if (half.length > 200 && body.indexOf(half, half.length) !== -1) {
      errors.push(
        `[${label}] ${skill}/SKILL.md: body appears duplicated — managed-block merge appended instead of replacing`,
      );
    }
```

### Step 8.3 — Add a cross-tree content-drift check

- [x] Extend `checkDrift()` (lines 115–134) to compare file *contents* across all five trees, not just the directory-name sets between two of them. Report any skill whose `SKILL.md` differs between trees as an error (the five task-tracking skills and the three pipeline skills are all currently expected to be identical everywhere).

### Step 8.4 — Wire it up

- [x] Add to root `package.json` scripts:

```json
"lint:skills": "node scripts/lint-skills.mjs",
```

- [x] Add a step to `.github/workflows/tests.yml` in the `Root suite` job, immediately after the existing `Verify generated platform compatibility documentation` step (line 101–102):

```yaml
      - name: Lint skill packages
        run: node scripts/lint-skills.mjs
```

### Verification for Task 8

- [x] Clean run:

```bash
node scripts/lint-skills.mjs; echo "exit=$?"
```

**Expected:** `✓ Skill lint passed — 0 errors, N warning(s)` and `exit=0`.

- [x] **Prove the guard actually catches each regression.** Introduce each defect, confirm the linter fails, then revert:

```bash
# 1. dangling reference
sed -i 's/Skill("mastermind-review")/Skill("mastermind-finish")/' .claude/skills/mastermind-execute/SKILL.md
node scripts/lint-skills.mjs; echo "exit=$?"     # expected: exit=1, names mastermind-finish
git checkout -- .claude/skills/mastermind-execute/SKILL.md

# 2. body duplication
cat .claude/skills/mastermind-plan/SKILL.md >> .claude/skills/mastermind-plan/SKILL.md
node scripts/lint-skills.mjs; echo "exit=$?"     # expected: exit=1, "body appears duplicated"
git checkout -- .claude/skills/mastermind-plan/SKILL.md

# 3. cross-tree drift
echo "drift" >> .gemini/skills/mastermind-issues/SKILL.md
node scripts/lint-skills.mjs; echo "exit=$?"     # expected: exit=1, names mastermind-issues
git checkout -- .gemini/skills/mastermind-issues/SKILL.md
```

A guard that has never been observed failing is not a guard.

- [x] Confirm the skill-directory-set parity test still passes (this plan adds no new skill directories, so it must):

```bash
npx vitest run tests/repo/claude-tree-parity.test.ts
```

**Expected:** 1 passed.

---

## Risks and open items

- **Task 0.4 is deliberately incomplete.** The managed-block append defect is diagnosed from `operations.ts:210-231` alone; `merge.ts` was not read. If the executor cannot confirm the mechanism, Task 8's detector still catches recurrences — but the generator will keep re-corrupting the trees on every `platforms install`, and each occurrence will need a manual `git checkout`. Trace `merge.ts` before closing this plan.
- **Task 7.1 depends on `captureCheckpoint()` already serializing the DAG.** If it does not, Step 7.1 grows to include the capture side. Verify before estimating.
- **Eight skills are referenced by the routing tables and do not exist.** This plan makes those references honest by redirecting them to real skills. That is a repair, not feature parity: a user asking for the behavior `mastermind-tdd` or `mastermind-finish` described still does not get it. Building them is a separate plan.
- **The normalization pass added in Task 2.1 is intended to be temporary.** It should be removed two releases after this ships. Nothing in this plan enforces that; it needs a tracked follow-up or it becomes permanent.
- **The `mastermind-review` / `mastermind-release` ↔ `monotask` coupling is untouched here.** The review flagged that `monotask` is unchecked on non-macOS (`doctor-monoes-checks.ts` short-circuits to "Skipped (macOS-only)" whenever `process.platform !== 'darwin'`, and this machine is Linux). That is a real gap in the review/release stages and is out of scope for this plan.
