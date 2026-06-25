---
name: mastermind-autodev
description: Mastermind autodev — autonomous research → build → review loop. Researches the project, picks the best improvement idea, builds it, then reviews with mastermind:review --tillend until clean. Repeats N times when given a count. Supports --newfeature N for full feature pipeline (research → build → review → document → deliver).
type: domain-skill
default_mode: auto
---

# Mastermind Autodev Domain

This skill is invoked directly via `/mastermind:autodev`.

Autodev is a fully autonomous loop: it researches the project, selects the highest-value improvement, builds it, and reviews it until clean — then repeats.

When `--newfeature N` is passed, it switches to **feature mode**: discovers the N best genuinely-new features the project is missing, then for each one runs the complete pipeline — Build → Review → Documentation → Delivery.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (loaded via _protocol.md Brain Load Procedure)
- `count`: number of improvements to build (default: 1; set by leading integer in arguments, e.g. `9 --tillend`)
- `newfeature_count`: when `--newfeature N` is set, number of brand-new features to discover and fully deliver (overrides normal improvement loop)
- `focus`: optional topic hint (e.g. "performance", "security", "dx") — narrows research phase
- `mode`: auto | confirm (default: auto)
- `current_rep` / `loop_id`: injected by _repeat.md on continuation runs

---

## Flag Parsing

Before anything else, extract from `$ARGUMENTS`:

1. **Leading integer** — if the first token is a bare integer (e.g. `9`), set `count = 9`. Remove it from the remaining args.
2. **`--count <N>`** — alternate way to set count.
3. **`--newfeature <N>`** — activate feature mode; set `newfeature_count = N`. When present, the normal improvement loop is **replaced** by the Feature Pipeline below. N is how many new features to discover and deliver end-to-end (must be ≥ 1).
4. **`--focus <topic>`** — set focus topic.
5. **`--auto` / `--confirm`** — mode.
6. **`--tillend`, `--repeat`, `--maxruns`, `--wait`, `--rep`, `--loop`** — handled by _repeat.md PREAMBLE before this skill runs.
7. Remaining text → `focus` hint (if no `--focus` was given).

If `count` is not set, default to `1`.
If `--newfeature` is present but N is missing or not a positive integer, default `newfeature_count = 3`.
If `newfeature_count > 10`: emit `[autodev] Warning: --newfeature capped at 10 (requested: N)` and set `newfeature_count = 10` before proceeding.
If `--newfeature` and `--tillend` are both present: emit `[autodev] Warning: --tillend is not supported with --newfeature and will be ignored.` and strip the tillend flag before proceeding.

---

## Feature Pipeline (--newfeature mode)

When `--newfeature N` is parsed, skip the normal improvement loop entirely and run this pipeline instead.

### FP-0 — Feature Discovery

**Goal:** Find the N best brand-new features the project is missing — not improvements to existing code, not bugfixes, not refactors. Things that would be genuinely new capability.

Run all research in parallel:

```bash
git log --oneline -30
find . -maxdepth 3 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.md" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" | head -80
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || true
cat README.md 2>/dev/null | head -120 || true
# Scan for capability gaps / user-facing TODOs
grep -rn "TODO\|could add\|future\|roadmap\|planned\|wish\|missing\|not yet\|coming soon" \
  --include="*.ts" --include="*.js" --include="*.py" --include="*.md" \
  . 2>/dev/null | grep -v node_modules | grep -v dist | head -40
```

Also call (parallel):
- `mcp__monomind__monograph_god_nodes` — find the most-connected modules (surfaces where new features plug in best)
- `mcp__monomind__monograph_suggest` with query `"missing feature new capability gap"` — graph-guided gaps
- `mcp__monomind__memory_search` with query `"autodev newfeature built"`, namespace `"mastermind:autodev"`, limit 30 — exclude already-delivered features

**Produce a ranked shortlist of up to `newfeature_count` features.** Aim for exactly `newfeature_count`, but stop at fewer only if the project genuinely has no more viable new features. After producing the shortlist — regardless of mode — **set `newfeature_count = len(shortlist)`** so the loop counter and FP-End summary are accurate. For each:

```
Feature <K>:
  title: <short imperative name, e.g. "Add batch export command">
  user_value: <one sentence — what a user gains>
  entry_point: <where in the codebase it plugs in (file/module)>
  feasibility: high | medium
  effort_estimate: small (< 100 LOC) | medium (100-400 LOC) | large (400+ LOC)
  type: feature
```

Priority ranking:
1. High feasibility first
2. High user_value for the effort
3. Not in recent git history
4. Not in autodev memory (already built)
5. Aligns with `focus` hint if given

If `mode = confirm`: display the full ranked shortlist and ask the user to approve before continuing. The user may strike features, reorder, or add constraints. After the user responds, update `approved_shortlist` to contain only the features the user kept, then **set `newfeature_count = len(approved_shortlist)`** before starting the FP-1..N loop. The FP-End summary denominator uses this updated count.

If `mode = auto`: `approved_shortlist = shortlist` (all features). `newfeature_count` was already aligned to `len(shortlist)` above — it does not revert to the originally parsed value.

Store the shortlist in memory:
```
mcp__monomind__memory_store(
  content: "autodev newfeature shortlist: [<title1>, <title2>, ...]. Session: <date>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "shortlist"]
)
```

---

### FP-1 through FP-N — Full Delivery Loop (one per feature)

Initialize the loop counter before starting:
```bash
K=0
```

For **each feature** in the ranked shortlist (1 through `newfeature_count`), run these phases in order. At the start of each iteration, increment K:
```bash
K=$((K + 1))
```

#### Phase A — Build

(`K` is the current loop index integer — e.g. `1`, `2`, `3`. Treat `$K` and `$FEATURE_FILE_LIST` as template values: re-emit them with the concrete value substituted at the top of each phase's bash block, since each shell invocation is independent. E.g. at the top of Phase B's block: `K=1; FEATURE_FILE_LIST="/tmp/autodev_feature_files_${K}.txt"`. The same rule applies to FP-End: assign `K=<final_newfeature_count>` at the top of the FP-End bash block before the cleanup loop.)

Before invoking build, snapshot untracked files so the post-build delta can be computed:
```bash
FEATURE_FILE_LIST="/tmp/autodev_feature_files_${K}.txt"
git ls-files --others --exclude-standard | sort > /tmp/autodev_untracked_before_${K}.txt
```

Invoke `Skill("mastermind:build")` with a detailed brief:

```
Brief must include:
  - Feature title and user_value
  - Concrete spec: inputs, outputs, API surface, CLI flags, UI, etc.
  - Entry point file(s) to create or modify — list every path explicitly
  - Acceptance criteria (3–5 testable outcomes)
  - What NOT to touch (blast radius guard)
  - Test requirements: at minimum one unit test and one integration test
```

Wait for build to complete before Phase B.

After build returns, determine which files this feature owns for staging in Phase D. The **build brief's declared file list** is the primary source of truth — it names every path the build was allowed to touch. Supplement it with only the files the build created that were not untracked before:

```bash
# 1. Write declared paths from the build brief (one per line)
printf '%s\n' \
  "path/to/file1.ts" \
  "path/to/file2.ts" \
  "tests/path/to/test1.ts" \
  > "$FEATURE_FILE_LIST"

# 2. Append any newly untracked files the build produced beyond the brief
#    (comm -13: lines only in file2 — i.e., new since the before-snapshot)
comm -13 \
  /tmp/autodev_untracked_before_${K}.txt \
  <(git ls-files --others --exclude-standard | sort) \
  >> "$FEATURE_FILE_LIST"
```

Store build start in memory:
```
mcp__monomind__memory_store(
  content: "autodev newfeature building: <title>",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "building"]
)
```

#### Phase B — Review Until Clean

Before starting the review loop, snapshot current working tree state (both unstaged and untracked) so the post-review delta is scoped only to this phase:
```bash
git diff --name-only | sort > /tmp/autodev_unstaged_before_B_${K}.txt
git ls-files --others --exclude-standard | sort > /tmp/autodev_untracked_before_B_${K}.txt
```

Inline review loop (same cap as improvement mode: max 5 iterations):

```
review_iter = 0
LOOP:
  review_iter += 1
  If review_iter > 5: EXIT LOOP (cap reached — log warning, continue)

  Invoke Skill("mastermind:review") with:
    prompt: "Review the new feature just built: <title>. Verify: correctness, edge cases,
             tests present and passing, no regressions, security, API consistency."
    brain_context: brain_context
    mode: auto
    (do NOT pass --tillend)

  If review returns zero findings: EXIT LOOP (clean)
  Else: auto-fix findings; continue loop
```

After the review loop exits, append only files this phase introduced (delta from before-snapshot), covering both modified tracked files and newly created untracked files:
```bash
# Tracked files modified by review (delta only — excludes files modified by prior features)
comm -13 \
  /tmp/autodev_unstaged_before_B_${K}.txt \
  <(git diff --name-only | sort) \
  >> "$FEATURE_FILE_LIST"
# Untracked files created by review (e.g. new test files)
comm -13 \
  /tmp/autodev_untracked_before_B_${K}.txt \
  <(git ls-files --others --exclude-standard | sort) \
  >> "$FEATURE_FILE_LIST"
sort -u "$FEATURE_FILE_LIST" -o "$FEATURE_FILE_LIST"
```

#### Phase C — Documentation

Before generating documentation, snapshot current working tree state:
```bash
git diff --name-only | sort > /tmp/autodev_unstaged_before_C_${K}.txt
git ls-files --others --exclude-standard | sort > /tmp/autodev_untracked_before_C_${K}.txt
```

After review is clean (or capped), generate documentation for the feature.

Invoke `Skill("mastermind:content")` with:
```
prompt: "Document the new feature '<title>' that was just built.
         Generate:
         1. A concise user-facing description (2-3 sentences) for README or CHANGELOG
         2. API/CLI/function-level docstrings for every new public symbol
         3. A usage example (runnable snippet or command)
         4. Any caveats or known limitations
         Write documentation inline into the relevant files — do not create standalone doc files
         unless the project already has a /docs directory pattern."
brain_context: brain_context
mode: auto
```

If `Skill("mastermind:content")` raises a "skill not found" or "skill unavailable" error, write the documentation directly:
- Add docstrings to all new public functions/classes/commands
- Update README.md (Features section or equivalent) with one bullet describing the feature
- Add a CHANGELOG entry under `[Unreleased]` only if `CHANGELOG.md` already exists in the project (check with `git ls-files CHANGELOG.md`); do NOT create it from scratch

After Phase C completes, append only files this phase introduced (delta from before-snapshot):
```bash
comm -13 \
  /tmp/autodev_unstaged_before_C_${K}.txt \
  <(git diff --name-only | sort) \
  >> "$FEATURE_FILE_LIST"
comm -13 \
  /tmp/autodev_untracked_before_C_${K}.txt \
  <(git ls-files --others --exclude-standard | sort) \
  >> "$FEATURE_FILE_LIST"
sort -u "$FEATURE_FILE_LIST" -o "$FEATURE_FILE_LIST"
```

#### Phase D — Delivery

(`$FEATURE_FILE_LIST` is the variable set at the top of Phase A: `/tmp/autodev_feature_files_${K}.txt`.)

Stage only the files declared for this feature. Do NOT commit — leave that to the user.

```bash
# Load file list, filtering blank lines, into an array (bash 4+)
mapfile -t _feat_files < <(grep -v '^[[:space:]]*$' "$FEATURE_FILE_LIST" 2>/dev/null)

# Guard: skip if file list is missing or contains only blank lines
if [ ${#_feat_files[@]} -eq 0 ]; then
  echo "[autodev:newfeature] Warning: Feature ${K} file list is empty — build may be a no-op. Skipping stage."
else
  # Stage only this feature's declared files. Exclude secrets/env.
  for f in "${_feat_files[@]}"; do
    case "$f" in
      .env|*.env|secrets*|credentials*) echo "Skipping sensitive file: $f" ;;
      *) git add -- "$f" 2>/dev/null || echo "Warning: could not stage $f" ;;
    esac
  done

  # Guard: detect no-op build (files listed but nothing actually changed)
  # Quoted array expansion handles filenames with spaces correctly
  if git diff --cached --quiet -- "${_feat_files[@]}"; then
    echo "[autodev:newfeature] Warning: Feature ${K} staged no changes — build produced no diff."
  else
    # Show what this feature contributed to the staged set (scoped to feature files only)
    git diff --cached --stat -- "${_feat_files[@]}"
  fi
fi
```

Log delivery:
```
[autodev:newfeature] Feature <K>/<newfeature_count> staged: <title>
Status: <staged|no-op|skipped>   # staged=changes in index, no-op=built but no diff, skipped=build failed/empty list
Review: <clean|capped>
Files changed: <git diff --cached --stat output scoped to this feature's files>
```

Track the outcome for FP-End: `feature_status[K] = staged|no-op|skipped`, `feature_review[K] = clean|capped|n/a`.

Suggest a commit message (print it, do not run it):
```
feat(<entry_point_module>): <title>

<user_value>

Delivered by mastermind:autodev --newfeature
```

Store completion in memory:
```
mcp__monomind__memory_store(
  content: "autodev newfeature built: <title> — <user_value>. Status: <status>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "built", status]
)
```

---

### FP-End — Summary

After all `newfeature_count` features complete, clean up tmp files and print a summary table:

```bash
# Re-assign K to the final feature count (each shell block is independent per Phase A rule)
K=<final_newfeature_count>   # substitute the actual integer, e.g. K=3
# Clean up per-feature tmp files
for k in $(seq 1 $K); do
  rm -f /tmp/autodev_feature_files_${k}.txt \
        /tmp/autodev_untracked_before_${k}.txt \
        /tmp/autodev_unstaged_before_B_${k}.txt \
        /tmp/autodev_untracked_before_B_${k}.txt \
        /tmp/autodev_unstaged_before_C_${k}.txt \
        /tmp/autodev_untracked_before_C_${k}.txt
done
```

Count staged features: `staged_count = count of features where feature_status[K] == "staged"`.

Print summary table (Status: `staged|no-op|skipped`; Review: `clean|capped|n/a`):

```
╔══════════════════════════════════════════════════════════════╗
║  autodev --newfeature  |  Session Summary                    ║
╠══════════════════════════════════════════════════════════════╣
║  Feature  │  Title                  │  Status   │  Review    ║
╠═══════════╪═════════════════════════╪═══════════╪════════════╣
║  1/<newfeature_count>  │  <title>   │  staged   │  clean     ║
║  2/<newfeature_count>  │  <title>   │  skipped  │  n/a       ║
║  ...                                                         ║
╚══════════════════════════════════════════════════════════════╝
Staged: <staged_count>/<newfeature_count> features. Run `git commit` to finalize.
```

---

## Loop: For Each Improvement (1 through `count`)

Run this sequence `count` times. After each completed improvement, increment the counter and continue — do not stop between improvements unless `mode = confirm` and the user declines.

### Phase 1 — Research

**Goal:** Understand the project deeply enough to pick the single best improvement to build right now.

Gather context from at minimum these sources — run all in parallel:

```bash
# Git log: what has been worked on recently
git log --oneline -20

# Project structure
find . -maxdepth 3 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.md" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" | head -60

# Package/project metadata
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || true

# README
cat README.md 2>/dev/null | head -80 || true

# Existing issues/todos (common patterns)
grep -rn "TODO\|FIXME\|HACK\|XXX\|BUG\|PERF\|DEBT" --include="*.ts" --include="*.js" --include="*.py" \
  --include="*.go" --include="*.md" . 2>/dev/null | grep -v node_modules | grep -v dist | head -30
```

Also call (parallel):
- `mcp__monomind__monograph_god_nodes` — find high-centrality files (architectural hotspots)
- `mcp__monomind__monograph_suggest` with query `"most impactful improvement"` — graph-guided suggestions
- `mcp__monomind__memory_search` with query `"autodev built"`, namespace `"mastermind:autodev"`, limit 20 — to exclude already-built improvements from candidates

If a `focus` hint was provided, bias all research toward that topic.

**Output of research phase:**
Produce a ranked list of 3–5 candidate improvements. For each candidate:
- `title`: one-line name
- `type`: feature | bugfix | refactor | performance | dx | security | test
- `why`: one sentence — why this helps the project most
- `feasibility`: high | medium (skip low — don't pick things that need days)
- `blast_radius`: files/modules affected (estimate)

### Phase 2 — Selection

Pick the **single best** candidate using this priority order:
1. Highest feasibility
2. Lowest blast radius for the value delivered
3. Aligns with `focus` hint (if given)
4. Not something already in git log from the last 20 commits

If `mode = confirm`: show the ranked list and selection, wait for user approval before proceeding.

If `mode = auto`: proceed immediately with the top pick.

Log the selection:
```
[autodev] Improvement <N>/<count>: <title> (<type>)
Rationale: <why>
Files affected: <blast_radius>
```

Store selection in memory so it's not re-picked next iteration:
```
mcp__monomind__memory_store(
  content: "autodev built: <title> — <why>",
  namespace: "mastermind:autodev",
  tags: ["autodev", "built", type]
)
```

### Phase 3 — Build

Invoke `Skill("mastermind:build")` with:
- `prompt`: detailed implementation brief for the selected improvement
- `brain_context`: the loaded brain context
- `project_name`: `$(basename "$PWD")`
- `mode`: `auto`
- `board_id`: the autodev board (only if non-empty; omit if monotask was unavailable)

The brief passed to build MUST include:
- What to build (concrete spec, not vague)
- Which files to touch
- Acceptance criteria (2–4 testable outcomes)
- What NOT to change (blast radius guard)

Wait for `mastermind:build` to complete before proceeding to Phase 4.

### Phase 4 — Review Until Clean

After build completes, enter an **inline** review loop (no ScheduleWakeup — must stay within this session):

```
review_iter = 0
LOOP:
  review_iter += 1
  If review_iter > 5: EXIT LOOP (cap reached)
  
  Invoke Skill("mastermind:review") with:
    prompt: "Review the changes just made for: <title>. Check correctness, tests, edge cases, security."
    brain_context: brain_context
    mode: auto
    (do NOT pass --tillend — that would schedule a ScheduleWakeup and break out of autodev)
  
  If review returns zero findings: EXIT LOOP (clean)
  Else: findings are auto-fixed by the reviewer; continue loop
```

**Critical:** Do not invoke the review command via `/mastermind:review --tillend ...`. That syntax schedules ScheduleWakeup continuations which would terminate the current autodev session. Always invoke inline with `Skill("mastermind:review")` only.

If the cap (5 iterations) is reached without a clean pass, log a warning and continue to Phase 5 — don't block the outer loop.

### Phase 5 — Log Completion

```
[autodev] Improvement <N>/<count> complete: <title>
Status: clean | capped (review issues remain)
```

Update brain with what was built:
```
mcp__monomind__memory_store(
  content: "autodev completed improvement <N>: <title>. Type: <type>. Status: <status>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "completed", type, status]
)
```

If `N < count`: log `[autodev] Moving to improvement <N+1>/<count>...` and repeat from Phase 1.

---

## Standalone Execution

1. Extract flags (leading integer for count, --newfeature N, --focus, --auto/--confirm)
2. Load brain context via _protocol.md Brain Load Procedure (namespace: `autodev`)
3. Create monotask board (optional — skip gracefully if monotask is not installed):
   ```bash
   project_name="${project_name:-$(basename "$PWD")}"
   board_id=$(monotask board create "autodev" --json 2>/dev/null | jq -r '.id // empty')
   [ -z "$board_id" ] && echo "[autodev] monotask board unavailable — board tracking skipped."
   ```
   Pass `board_id` to `mastermind:build` only if non-empty; omit the parameter otherwise.
4. **If `--newfeature` was parsed:** run the Feature Pipeline (FP-0 through FP-End) and skip the improvement loop entirely.
   **Otherwise:** run the Loop section above for each improvement.
5. At end: follow _protocol.md Brain Write Procedure (namespace: `autodev`)

---

## Tillend Integration

**`--newfeature` is incompatible with `--tillend`.** Both the command and skill strip `--tillend` and emit a warning when both are present. This is because the Feature Pipeline has a fundamentally different termination model (a fixed shortlist of N features, not an open-ended "until exhausted" loop), and the FP-0 discovery + FP-End staging structure does not map onto the per-wakeup session model that `--tillend` assumes.

For the standard improvement loop: when `--tillend` wraps autodev, each ScheduleWakeup wakeup runs a **full autodev session** (all `count` improvements). Memory deduplication (Phase 1 searches `"autodev built"`) prevents already-built improvements from being re-picked in subsequent wakeups.

- `count` controls improvements **per session** (default: 1)
- `--tillend` keeps scheduling new sessions until an empty round
- An empty round occurs when Phase 1 research finds no viable new candidates (all feasible work is already in memory)

The loop terminates naturally when the project has no more improvements worth building — not based on hitting a fixed count across wakeups.

---

## Safety Guards

- Never delete files unless the improvement or feature explicitly requires it
- Never modify `.env`, secrets, credentials
- Never commit (only stage) — leave commit to the user
- If Phase A (build) fails or produces no output: skip this feature, log the skip, continue to next feature
- If Phase B (review) skill is unavailable or throws: log a warning, treat as capped (review issues may remain), continue to Phase C
- If Phase C (documentation) skill is unavailable: fall back to inline documentation; if that also fails, log and continue to Phase D
- If Phase D (delivery) `git add` fails on multiple files: log each failure, stage what succeeded, continue
- If all research candidates are infeasible: ask the user for a focus direction instead of guessing
- **`--newfeature` specific:**
  - Features must be genuinely new — reject any candidate that is just a refactor or bugfix of existing code
  - Do not create standalone `.md` doc files unless the project already has a `/docs` directory
  - Stage only the files declared in the build brief for each feature (written to `$FEATURE_FILE_LIST` in Phase A), supplemented only by newly untracked files the build produced (detected via before/after `git ls-files` delta) — never use `git add --all` in feature mode
  - Each feature's staged set is driven by its build brief's declared file list, making it deterministic and cross-feature safe
  - `newfeature_count > 10` is caught at parse time and capped to 10 before any pipeline runs
  - `--tillend` combined with `--newfeature` is rejected at parse time with a clear warning
