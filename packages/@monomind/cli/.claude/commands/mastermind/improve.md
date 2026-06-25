---
name: mastermind:improve
description: "Mastermind — Deeply analyze a component, research improvements online, and create improvement tasks saved to docs/improvements/ (default) or monotask boards (--monotask flag)"
---

**First — extract repeat flags:** Follow the REPEAT PREAMBLE from `_repeat.md`. Extracts `--repeat`, `--tillend`, `--maxruns`, `--wait`, `--rep`, `--loop` from `$ARGUMENTS` before all other parsing. If `is_continuation = true`, skip the empty-arguments check below.

If `$ARGUMENTS` is empty, output this and STOP:

> **Usage:** `/mastermind:improve <component or concept>`
>
> Examples:
> - `/mastermind:improve the authentication flow`
> - `/mastermind:improve error handling across the codebase`
> - `/mastermind:improve CLI startup performance`
> - `/mastermind:improve the MCP server architecture`
>
> By default, analysis is saved to `docs/improvements/YYYY-MM-DD-<slug>.md`. Add `--monotask` to write to a monotask board instead.

Do NOT proceed further if no arguments were provided.

**Extract `--monotask` flag:** If present, set `USE_MONOTASK=true` and remove from `$ARGUMENTS`. Default: `USE_MONOTASK=false`.

---

## Step 0: Check monotask CLI *(skip unless `--monotask` was passed)*

**Only run this step if `USE_MONOTASK=true`.**

```bash
command -v monotask || (command -v cargo && cargo install monotask)
```
If neither exists, tell user to install Rust + monotask and STOP.

---

## Step 1: Gather Project Context

Collect ALL of the following in parallel (skip any that error):

1. **Repo name**: Run `git remote get-url origin`, extract the last path segment, strip `.git`. Fallback: `basename` of the current working directory. Store as `REPO_NAME`.

2. **README**: Read `README.md` (first 200 lines). Skip if missing.

3. **Package manifest**: Read whichever exists first: `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`. Extract name, description, and keywords/tags.

4. **Knowledge graph**: Call `mcp__monomind__monograph_suggest` with the user's prompt (`$ARGUMENTS`). Skip if it errors or returns empty.

5. **Memory search**: Call `mcp__monomind__memory_search` with the user's prompt (`$ARGUMENTS`). Use the top 5 results.

Bundle all gathered information into a single `PROJECT_CONTEXT` string for downstream agents.

**DELEGATION RULE:** Every agent spawned in this command MUST include the `== AGENT DELEGATION CAPABILITY ==` block (from `mastermind/_delegation.md`) in its prompt, immediately before `YOUR GOAL:`. This lets each agent spawn its own sub-agents when needed — delegation is recursive.

---

## Step 2: Deep Component Analysis

This is what differentiates `/mastermind:improve` from `/mastermind:ideate`. Before generating improvement ideas, we must deeply understand the current state of the target component.

Spawn 2 agents in parallel via the Agent tool:

### Agent 1: `feature-dev:code-explorer`

Provide it with `$ARGUMENTS` and `PROJECT_CONTEXT`. It must:

1. **Trace the component** — find all files, functions, classes, and modules related to the target. Use `mcp__monomind__monograph_query` for each key term found.
2. **Map dependencies** — what does the component depend on? What depends on it? Use `mcp__monomind__monograph_shortest_path` for key relationships.
3. **Identify pain points** — look for:
   - Code smells (large files, deep nesting, god objects, duplicated logic)
   - Missing tests or low coverage areas
   - Performance bottlenecks (synchronous I/O, N+1 patterns, unnecessary allocations)
   - Security gaps (unvalidated inputs, missing auth checks, exposed secrets)
   - API inconsistencies (naming, error shapes, response formats)
   - Outdated patterns (callbacks vs async/await, old library versions)
   - Missing error handling or silent failures
4. **Measure complexity** — count files, lines, dependencies, and circular references.

Return a structured analysis:
```json
{
  "component": "name",
  "files": ["list of files touched"],
  "total_lines": N,
  "dependency_count": N,
  "pain_points": [
    { "type": "code-smell|perf|security|api|testing|pattern", "description": "...", "file": "path", "severity": "critical|high|medium|low" }
  ],
  "strengths": ["things that are already well done"],
  "architecture_notes": "how it fits into the larger system"
}
```

### Agent 2: `researcher` (with WebSearch)

Provide it with `$ARGUMENTS` and `PROJECT_CONTEXT`. It must:

1. **Search for best practices** related to the component's domain (e.g., "authentication best practices 2025", "CLI performance optimization techniques").
2. **Find competitor/prior art** — how do similar tools/libraries solve this?
3. **Search for common improvements** — what do blog posts, conference talks, and docs recommend?
4. **Identify emerging patterns** — new libraries, frameworks, or techniques relevant to this area.

Return structured research:
```json
{
  "best_practices": [
    { "title": "...", "description": "...", "source": "url or reference" }
  ],
  "prior_art": [
    { "project": "name", "approach": "how they solve it", "takeaway": "what we can learn" }
  ],
  "emerging_patterns": [
    { "pattern": "name", "description": "...", "relevance": "why it matters for us" }
  ]
}
```

After both agents complete, merge their outputs into `COMPONENT_ANALYSIS`.

---

## Step 3: Setup Storage

**File mode (default):**
```bash
DATE=$(date +%Y-%m-%d)
SLUG=$(echo "$ARGUMENTS" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g; s/-\+/-/g; s/^-//; s/-$//' | cut -c1-40)
IMPROVE_FILE="docs/improvements/${DATE}-${SLUG}.md"
mkdir -p docs/improvements
```
Write the file header using the Write tool:
```markdown
---
source: mastermind:improve
repo: <REPO_NAME>
created: <DATE>
component: <$ARGUMENTS>
---

# Improvements: <$ARGUMENTS>

```
Store `IMPROVE_FILE`.

---

**Monotask mode:**
- Find or create space `$REPO_NAME` → store `SPACE_ID`
- Find or create `monomind-improve` board with columns: `Discovered`, `Evaluated`, `Approved`, `Tasked`, `Deferred`, `Rejected` → store `BOARD_ID` and all column IDs

---

## Step 4: Generate Improvement Ideas

Spawn a single `Software Architect` agent via the Agent tool. Provide it with:
- The user's prompt: `$ARGUMENTS`
- The full `COMPONENT_ANALYSIS` from Step 2
- The `PROJECT_CONTEXT` from Step 1

The agent must synthesize the code analysis and online research into concrete improvement ideas. For each idea, produce:

```json
{
  "title": "Short, action-oriented title",
  "description": "2-3 sentences: what the improvement is, what problem it solves, and the expected benefit.",
  "category": "performance | security | reliability | maintainability | dx | testing | architecture",
  "evidence": "What from the analysis or research supports this (pain point ref, best practice ref, or prior art ref)",
  "estimated_impact": "Concrete expected outcome (e.g., '50% faster CLI startup', 'eliminate 3 code smells', 'cover 5 untested edge cases')"
}
```

**Idea generation rules:**
- Ideas must be grounded in the analysis — no generic "add more tests" without pointing to specific gaps
- Each idea must reference either a pain point from the code analysis or a best practice from the research
- Prefer high-impact, low-effort ideas first
- Include at least one idea from each applicable category (perf, security, testing, etc.)
- No duplicates — each idea must address a distinct improvement

Persist each improvement:

**File mode:** Append to `IMPROVE_FILE` using the improvement section format from `_taskfile.md`:
```markdown
### <Improvement Title>
> status: discovered
> category: <category>

<description>

**Evidence:** <evidence>
**Estimated impact:** <estimated_impact>

---
```

**Monotask mode:**
```bash
monotask card create $BOARD_ID $COL_DISCOVERED "<title>" --json
monotask card comment add $BOARD_ID $CARD_ID "<description>"
monotask card comment add $BOARD_ID $CARD_ID "Category: <category>\nEvidence: <evidence>\nExpected impact: <estimated_impact>"
monotask card label add $BOARD_ID $CARD_ID "monomind-improve"
```

If zero improvements were generated, report "No improvement opportunities found for this component." and STOP.

---

## Step 5: Evaluate and Prioritize

Spawn a single `Product Manager` agent via the Agent tool. Provide it with:
- All improvement ideas (titles, descriptions, and all comments)
- The `COMPONENT_ANALYSIS`
- The `PROJECT_CONTEXT`

For EACH idea, the agent must return one of three verdicts, along with **impact** (0-10) and **effort** (0-10) scores:

| Verdict | Criteria |
|---------|----------|
| **approved** | High value, feasible, aligns with project direction. Include a `skipElaboration` boolean: `true` if straightforward, `false` if needs deeper investigation. |
| **deferred** | Good idea but wrong timing, blocked by something, or needs more research. Include the reason. |
| **rejected** | Low value, too risky, or out of scope. Include a 1-sentence reason. |

For each verdict, update storage:

**File mode:** Edit `IMPROVE_FILE` — update the `> status:` line and append relevant fields:
- *approved:* `> status: evaluated`, add `> impact: N`, `> effort: N`, `> skip_elaboration: true|false`, append `**Value:** <value statement>`
- *deferred:* `> status: deferred`, add impact/effort, append `**Deferred reason:** <reason>`
- *rejected:* `> status: rejected`, append `**Rejected reason:** <reason>`

**Monotask mode:**
- *approved:* move to Evaluated + set impact/effort + add value comment
- *deferred:* move to Deferred + set impact/effort + add reason comment
- *rejected:* move to Rejected + add reason comment

If ALL improvements were deferred or rejected, output a summary table and STOP.

---

## Step 6: Elaborate Approved Improvements

Check if ANY approved ideas have `skipElaboration: false`.

**If ALL approved improvements have `skipElaboration: true`:**
- *File mode:* Change each improvement's `> status: evaluated` → `> status: approved` in `IMPROVE_FILE`
- *Monotask mode:* `monotask card move $BOARD_ID $CARD_ID $COL_APPROVED --json`
- Skip spawning agents.

**Otherwise**, spawn two agents in parallel via the Agent tool:

1. A `feature-dev:code-explorer` agent — traces implementation paths, identifies exactly which files/functions need to change, surfaces hidden constraints and breaking changes.
2. A `researcher` agent (with WebSearch) — searches for implementation patterns, migration guides, and gotchas specific to each improvement.

After both complete, for each improvement needing elaboration:
1. Persist findings:
   - *File mode:* Edit `IMPROVE_FILE` — append `**Implementation path:** <files>`, `**Risks:** <breaking changes>`, `**Research:** <patterns>` under the improvement section. If no blocking issues: change `> status: evaluated` → `> status: approved`. If blocking issue: change to `> status: deferred`, append `**Deferred reason:** <issue>`.
   - *Monotask mode:* Add three comments for implementation path, risks, research. Move to `Approved` or `Deferred` accordingly.

Also mark `skipElaboration: true` improvements as `approved`.

---

## Step 7: Task Decomposer — Break Improvements into Subtasks

### Generate the TASKS Array

Spawn a single `Software Architect` agent via the Agent tool. Provide it with:
- All ideas in the `Approved` column (titles, descriptions, and all comments including implementation paths and research)
- The `COMPONENT_ANALYSIS` from Step 2
- The `PROJECT_CONTEXT`
- **The Task Grouping Rules and Card Format from `/mastermind:createtask` Step 5** — include them verbatim in the agent prompt so it produces correctly structured tasks

The agent MUST produce a `TASKS` array following the `/mastermind:createtask` task card format (Step 5). Each task must comply with all 7 grouping rules. For each approved improvement, decompose into 2-6 subtasks.

**If the architect has doubts** about decomposing an improvement (unclear scope, missing info):
- Add a comment with the question
- Move the improvement to `Deferred` instead of `Tasked`

Store the result as `TASKS` array.

### Persist Task Decomposition

**File mode:** Follow `/mastermind:createtask` Steps 6–7 (file mode) to write a new task file. Use:
- `SOURCE_TAG` = `"mastermind:improve"`
- `SOURCE_SUMMARY` = first 100 chars of `$ARGUMENTS`

After writing the task file, update `IMPROVE_FILE`:
- For each parent improvement: change `> status: approved` → `> status: tasked`, append `**Subtasks file:** <TASK_FILE> (N tasks created)`

**Monotask mode:** Follow `/mastermind:createtask` Steps 6–7 (monotask mode) with:
- `SOURCE_TAG` = `"mastermind:improve"`
- After cards created: annotate parent card and move it to `Tasked`

Then follow `/mastermind:createtask` Step 8 (Final Dependency Review) and report results.

---

## Step 8: Final Summary

Output a component health report:

```
## Improvement Analysis: <component>

### Component Health
- Files analyzed: N
- Pain points found: N (X critical, Y high, Z medium)
- Strengths identified: N

### Improvement Pipeline
| # | Improvement                 | Category       | Status   | Impact | Effort | Subtasks |
|---|-----------------------------|----------------|----------|--------|--------|----------|
| 1 | <title>                     | performance    | Tasked   | 8      | 4      | 3        |
| 2 | <title>                     | security       | Deferred | 7      | 8      | --       |
| 3 | <title>                     | testing        | Rejected | --     | --     | --       |

### Summary
- Improvements discovered: N
- Improvements tasked: N (with M total subtasks)
- Total effort points: X
- Improvements deferred: N
- Improvements rejected: N
```

Output file/board references:
- *File mode:* Improvement file: `<IMPROVE_FILE>` | Task file: `<TASK_FILE>`
- *Monotask mode:* Space: `$REPO_NAME` | Improve board: `monomind-improve` | Task board: `monomind-task`

---

## Step 9: Offer to Execute Tasks

If there are todo tasks:

*File mode:*
```
Skill("mastermind:do", "--file <TASK_FILE> --mode <parallel|minimal|sequential>")
```

*Monotask mode:*
```
Skill("mastermind:do", "--monotask --space $SPACE_ID --board $TASK_BOARD_ID --mode <parallel|minimal|sequential>")
```

To repeat this command on a schedule, wrap it with `/mastermind:repeat` or use `--repeat N` / `--tillend` directly.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
