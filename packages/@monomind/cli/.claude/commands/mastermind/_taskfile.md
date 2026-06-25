---
name: _taskfile
description: Shared file-based task/idea/improvement format for mastermind commands. Defines markdown structure, status enum, status transitions, prerequisite-unblock logic, and file paths. Referenced by createtask, do, ideate, and improve — do NOT duplicate this spec.
---

# Task File Format Spec

**Referenced by:** `mastermind:createtask`, `mastermind:do`, `mastermind:ideate`, `mastermind:improve`

---

## File Locations

| Command | Output path |
|---|---|
| `mastermind:createtask` | `docs/tasks/YYYY-MM-DD-<slug>.md` |
| `mastermind:ideate` | `docs/ideas/YYYY-MM-DD-<slug>.md` |
| `mastermind:improve` | `docs/improvements/YYYY-MM-DD-<slug>.md` |

**Slug generation:** Take the first 40 characters of the user's prompt/input label. Lowercase, replace spaces and non-alphanumeric chars with `-`, collapse consecutive `-`, strip leading/trailing `-`.

Example: `"Build a webhook delivery system"` → `build-a-webhook-delivery-system`

---

## Task File Structure

Every task file produced by `mastermind:createtask` (and by the decomposition step in `ideate`/`improve`):

```
---
source: mastermind:createtask
repo: <REPO_NAME>
created: YYYY-MM-DD
prompt: <first 100 chars of input>
recommended_mode: parallel | minimal | sequential
---

# Tasks: <INPUT_LABEL>

<2-3 sentence summary of what these tasks implement>

---

## Task 1: <Action-oriented title (verb + noun + context)>

> status: todo
> agent: <agent_type>
> priority: critical | high | medium | low
> effort: <1-10>
> context_group: <group_name> | independent
> prerequisites: none | <comma-separated task titles exactly as written above>
> parallel_safe: true | false

### What
<Exact deliverable — 1-3 sentences>

### Why
<Motivation — 1-2 sentences>

### Where
<File paths and module boundaries>

### Context
<All relevant context: patterns, related files, API shapes, data models. Include file paths from monograph.>

### Definition of Done
- [ ] <Specific, binary, verifiable condition>
- [ ] <Specific, binary, verifiable condition>

### Testing Criteria
- Unit: `function(input) → expected outcome`
- Integration: `endpoint + method → status + response shape`
- Edge case: `boundary condition → expected behavior`

### Checklist
- [ ] <Step 1>
- [ ] <Step 2>
- [ ] Run tests — verify green
- [ ] Commit: '<type>: <description>'

---
```

Repeat `## Task N: ...` blocks for each task. Use `---` horizontal rules to visually separate tasks.

---

## Status Values

The `> status:` blockquote line in each task section is the single source of truth for lifecycle state:

| Value | Meaning |
|---|---|
| `backlog` | Has unmet prerequisites — not ready to start |
| `todo` | Ready to be picked up |
| `in_progress` | Agent is actively working |
| `review` | Agent reported DONE/DONE_WITH_CONCERNS — pending reviewer approval |
| `blocked` | Agent reported BLOCKED, or reviewer failed after 3 cycles — human decision needed |
| `done` | Reviewer approved — all checklist items complete |

---

## Status Transitions (`mastermind:do` applies these)

**Edit mechanism:** Use the `Edit` tool to replace `> status: <old_value>` with `> status: <new_value>` within the specific task's section. Match by task heading (`## Task N: <title>`) to scope the edit to the right task.

1. **Claim task**: `todo` → `in_progress`
2. **Agent reports DONE/DONE_WITH_CONCERNS**: `in_progress` → `review` (hold here until reviewer approves)
3. **Reviewer approves**: `review` → `done` AND replace all `- [ ]` with `- [x]` in that task's Checklist section
4. **Agent reports BLOCKED**: `in_progress` → `blocked` AND append a new blockquote line `> blocked_reason: <question or issue>`
5. **Review failed after 3 cycles**: `review` → `blocked` AND append `> blocked_reason: max review cycles reached — <unresolved issues>`
6. **DONE_WITH_CONCERNS**: after reviewer approves, append `> concerns: <concerns text>` line

---

## Prerequisite Unblock Logic (`mastermind:do`)

After any task transitions to `status: done`:

1. Note the task's exact title text (everything after `## Task N: `)
2. Scan the same file for ALL task sections where the `> prerequisites:` line contains that exact title as one of the comma-separated values
3. For each such dependent task:
   - Read each prerequisite listed for it
   - Check whether ALL those prerequisites have `> status: done` in their section
   - If yes → Edit `> status: backlog` to `> status: todo` in the dependent's section
   - If any prerequisite is not yet `done` → leave the dependent's status unchanged

---

## Scanning for Pending Tasks (`mastermind:do` parse spec)

To find work from a file:
1. Read the entire file with the `Read` tool
2. Find all sections with heading `## Task \d+: ` (level-2 headings starting with "Task N: ")
3. For each section, read the `> status:` line
4. **Todo tasks** = sections with `status: todo`
5. **Backlog tasks** = sections with `status: backlog`
6. To read a task's full context: read from `## Task N: <title>` to the next `---` separator or next `## Task` heading

---

## Idea File Structure (`mastermind:ideate` output)

File: `docs/ideas/YYYY-MM-DD-<slug>.md`

Ideas are appended chronologically. Status is tracked in-place via `> status:` — sections are NOT physically moved between column headings. The column headings (New/Evaluated/etc.) are used only for initial placement during creation; subsequent updates only change the `> status:` line.

```
---
source: mastermind:ideate
repo: <REPO_NAME>
created: YYYY-MM-DD
prompt: <prompt>
---

# Ideas: <prompt>

---

### <Idea Title>
> status: new | evaluated | iced | rejected | elaborated | tasked
> category: feature | technical-baseline
> impact: <0-10 once evaluated>
> effort: <0-10 once evaluated>
> skip_elaboration: true | false

<2-3 sentence description>

**Value:** <value statement once evaluated>
**Blocked by:** <blocking question if iced>
**Rejected reason:** <reason if rejected>
**Edge cases:** <findings if elaborated>
**Technical notes:** <notes if elaborated>
**Subtasks file:** `docs/tasks/<task-file>.md` (N tasks created)

---
```

Repeat `### <Idea Title>` blocks for each idea.

**Idea status values:** `new` → `evaluated` | `iced` | `rejected` → `elaborated` | `iced` → `tasked`

---

## Improvement File Structure (`mastermind:improve` output)

File: `docs/improvements/YYYY-MM-DD-<slug>.md`

Same flat-with-status-in-place pattern as idea files.

```
---
source: mastermind:improve
repo: <REPO_NAME>
created: YYYY-MM-DD
component: <component name>
---

# Improvements: <component>

---

### <Improvement Title>
> status: discovered | evaluated | approved | deferred | rejected | tasked
> category: performance | security | reliability | maintainability | dx | testing | architecture
> impact: <0-10 once evaluated>
> effort: <0-10 once evaluated>
> skip_elaboration: true | false

<2-3 sentence description>

**Evidence:** <pain point or best practice reference>
**Estimated impact:** <concrete expected outcome>
**Value:** <value statement once evaluated>
**Implementation path:** <files and functions to change, once elaborated>
**Risks:** <breaking changes, migration needs>
**Research:** <patterns and references found>
**Deferred reason:** <reason if deferred>
**Rejected reason:** <reason if rejected>
**Subtasks file:** `docs/tasks/<task-file>.md` (N tasks created)

---
```

**Improvement status values:** `discovered` → `evaluated` | `deferred` | `rejected` → `approved` | `deferred` → `tasked`

---

## Format Contract Notes

- `> status:` lines use blockquote syntax so they're visually distinct from body text and parseable by `grep '^> status:'`
- Prerequisites reference task titles **exactly as written** — case-sensitive, full title text after `## Task N: `
- The `---` separator after each task/idea/improvement block is required — it's what `mastermind:do` uses to delimit sections
- All `- [ ]` and `- [x]` checklist items are standard GFM checkboxes — use the `Edit` tool to flip `[ ]` → `[x]`
