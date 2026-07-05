---
name: mastermind-autodev
description: Mastermind autodev — autonomous research → build → review loop. Researches the project, picks the best improvement idea, builds it, then runs an inline review loop until clean. Repeats N times when given a count. Supports --newfeature N for full feature pipeline (research → build → review → document → deliver).
type: domain-skill
default_mode: auto
---

# Mastermind Autodev Domain

Invoked via `/mastermind:autodev`. Fully autonomous: research the project, select the highest-value work, build it, review until clean, repeat.

Two modes:
- **Improvement loop** (default): `count` iterations of Research → Select → Build → Review → Log.
- **Feature pipeline** (`--newfeature N`): discover the N best genuinely-new features, then for each run Build → Review → Document → Stage. Replaces the improvement loop entirely.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (loaded via _protocol.md Brain Load Procedure)
- `count`: number of improvements to build (default: 1; set by leading integer in arguments)
- `newfeature_count`: set by `--newfeature N` — number of brand-new features to discover and fully deliver
- `focus`: optional topic hint (e.g. "performance", "security", "dx") — narrows research
- `mode`: auto | confirm (default: auto)
- `current_rep` / `loop_id`: injected by _repeat.md on continuation runs

---

## Flag Parsing

When invoked via the `/mastermind:autodev` command these arrive pre-parsed; parse `$ARGUMENTS` yourself only when running standalone.

1. **Leading bare integer** (e.g. `9`) → `count = 9`; remove from remaining args.
2. `--count <N>` → alternate way to set `count`.
3. `--newfeature <N>` → feature mode. Missing or invalid N → default 3. N > 10 → emit `[autodev] Warning: --newfeature capped at 10 (requested: N)` and cap.
4. `--focus <topic>` → focus.
5. `--auto` / `--confirm` → mode.
6. `--tillend`, `--repeat`, `--maxruns`, `--wait`, `--rep`, `--loop` → handled by the _repeat.md PREAMBLE before this skill runs. If `--tillend` and `--newfeature` are both present: emit `[autodev] Warning: --tillend is not supported with --newfeature and will be ignored.` and strip `--tillend` (the pipeline delivers a fixed shortlist, not an open-ended loop).
7. Remaining text → `focus` hint if none was given.

Default `count = 1`.

---

## Shared Recipes

### R1 — Project Research (run everything in parallel)

```bash
git log --oneline -30
find . -maxdepth 3 -type f \( -name "*.ts" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.md" \) \
  ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" | head -80
cat package.json 2>/dev/null || cat pyproject.toml 2>/dev/null || cat go.mod 2>/dev/null || true
head -120 README.md 2>/dev/null || true
grep -rn "<PATTERNS>" --include="*.ts" --include="*.js" --include="*.py" --include="*.go" --include="*.md" \
  . 2>/dev/null | grep -v node_modules | grep -v dist | head -40
```

Plus these MCP calls (also parallel):
- `mcp__monomind__monograph_god_nodes` — high-centrality modules (hotspots / where new features plug in)
- `mcp__monomind__monograph_suggest` — query per mode below
- `mcp__monomind__memory_search` — namespace `"mastermind:autodev"`, to exclude already-built work

Mode-specific values:

| | Improvement loop | Feature pipeline |
|---|---|---|
| `<PATTERNS>` | `TODO\|FIXME\|HACK\|XXX\|BUG\|PERF\|DEBT` | `TODO\|could add\|future\|roadmap\|planned\|wish\|missing\|not yet\|coming soon` |
| monograph_suggest query | `"most impactful improvement"` | `"missing feature new capability gap"` |
| memory_search query / limit | `"autodev built"` / 20 | `"autodev newfeature built"` / 30 |

If a `focus` hint was provided, bias all research toward it.

### R2 — Review Until Clean (inline, max 5 iterations)

```
review_iter = 0
LOOP:
  review_iter += 1
  If review_iter > 5: EXIT LOOP (capped — log a warning, continue to the next phase; don't block)

  Invoke Skill("mastermind-skills:review") with:
    prompt: "Review the changes just made for: <title>. Verify: correctness, edge cases,
             tests present and passing, no regressions, security, API consistency."
    brain_context: brain_context
    mode: auto

  If review returns zero findings: EXIT LOOP (clean)
  Else: auto-fix findings; continue loop
```

**Critical:** never pass `--tillend` to review and never invoke it as `/mastermind:review --tillend`. That schedules a ScheduleWakeup continuation and terminates the autodev session. Always invoke inline via `Skill("mastermind-skills:review")`. If the review skill is unavailable or throws: log a warning, treat as capped, continue.

---

## Improvement Loop (default mode)

Repeat `count` times, N = 1..count. Do not stop between improvements unless `mode = confirm` and the user declines.

### Phase 1 — Research

Run R1 (improvement column). Produce 3–5 ranked candidates:
- `title`: one-line name
- `type`: feature | bugfix | refactor | performance | dx | security | test
- `why`: one sentence — why this helps the project most
- `feasibility`: high | medium (skip low — nothing that needs days)
- `blast_radius`: files/modules affected (estimate)

### Phase 2 — Selection

Pick the single best candidate: 1) highest feasibility, 2) lowest blast radius for the value, 3) matches `focus`, 4) not already in the last 20 commits.

If `mode = confirm`: show the ranked list and selection, wait for approval. If `mode = auto`: proceed immediately.

Log:
```
[autodev] Improvement <N>/<count>: <title> (<type>)
Rationale: <why>
Files affected: <blast_radius>
```

Store immediately so it isn't re-picked next iteration:
```
mcp__monomind__memory_store(
  content: "autodev built: <title> — <why>",
  namespace: "mastermind:autodev",
  tags: ["autodev", "built", type]
)
```

### Phase 3 — Build

Invoke `Skill("mastermind-skills:build")` with:
- `prompt`: detailed implementation brief (MUST include: concrete spec, which files to touch, 2–4 testable acceptance criteria, what NOT to change)
- `brain_context`, `mode: auto`, `project_name: $(basename "$PWD")`
- `board_id`: only if non-empty; omit if monotask was unavailable

Wait for build to complete.

### Phase 4 — Review

Run R2.

### Phase 5 — Log Completion

```
[autodev] Improvement <N>/<count> complete: <title>
Status: clean | capped (review issues remain)
```

```
mcp__monomind__memory_store(
  content: "autodev completed improvement <N>: <title>. Type: <type>. Status: <status>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "completed", type, status]
)
```

If N < count: log `[autodev] Moving to improvement <N+1>/<count>...` and repeat from Phase 1.

---

## Feature Pipeline (--newfeature mode)

`K` is the current feature index (1..`newfeature_count`). Bash blocks below are templates — substitute the concrete integer for `${K}` when emitting them, since each shell invocation is independent.

### FP-0 — Feature Discovery

**Goal:** the N best brand-new features the project is missing — genuinely new capability, not improvements, bugfixes, or refactors of existing code.

Run R1 (feature column). Produce a ranked shortlist of up to `newfeature_count` features — aim for exactly that many; stop at fewer only if the project genuinely has no more viable ones. For each:

```
Feature <K>:
  title: <short imperative name, e.g. "Add batch export command">
  user_value: <one sentence — what a user gains>
  entry_point: <where in the codebase it plugs in (file/module)>
  feasibility: high | medium
  effort_estimate: small (< 100 LOC) | medium (100–400 LOC) | large (400+ LOC)
  type: feature
```

Rank by: feasibility, then user_value per effort, then not in recent git history, not already in autodev memory, alignment with `focus`.

If `mode = confirm`: display the shortlist and wait — the user may strike features, reorder, or add constraints; keep only what they approve.
In either mode, **set `newfeature_count = len(final shortlist)`** — the loop counter and FP-End denominator use this value.

```
mcp__monomind__memory_store(
  content: "autodev newfeature shortlist: [<title1>, <title2>, ...]. Session: <date>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "shortlist"]
)
```

Snapshot the pre-existing dirty state **once**, before any feature builds — this baseline keeps the user's unrelated files out of staging. Bookkeeping files live in the repo's `.git` dir so concurrent autodev sessions in other repos can't collide:
```bash
{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u \
  > "$(git rev-parse --git-dir)/autodev_baseline.txt"
```

### FP-1 through FP-N — per feature, in shortlist order

#### Phase A — Build

```
mcp__monomind__memory_store(
  content: "autodev newfeature building: <title>",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "building"]
)
```

Invoke `Skill("mastermind-skills:build")` with a brief that includes:
- Feature title and user_value
- Concrete spec: inputs, outputs, API surface, CLI flags, UI, etc.
- Entry point file(s) to create or modify — list every path explicitly
- Acceptance criteria (3–5 testable outcomes)
- What NOT to touch (blast radius guard)
- Test requirements: at minimum one unit test and one integration test

Wait for completion. If build fails or produces no output: mark the feature `skipped`, log it, continue to the next feature.

#### Phase B — Review Until Clean

Run R2 with the prompt scoped to the new feature `<title>`.

#### Phase C — Documentation

Invoke `Skill("mastermind-skills:content")` with:
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

If the content skill is unavailable, write the documentation directly:
- Docstrings on all new public functions/classes/commands
- One README bullet (Features section or equivalent)
- CHANGELOG entry under `[Unreleased]` only if `CHANGELOG.md` already exists (`git ls-files CHANGELOG.md`) — never create it

If that also fails: log and continue to Phase D.

#### Phase D — Delivery (stage only, never commit)

Everything this feature touched is exactly the current unstaged + untracked set minus the session baseline — previous features' files are already in the index:

```bash
K=1   # substitute the current feature index
GITDIR=$(git rev-parse --git-dir)
LIST="$GITDIR/autodev_feature_${K}.txt"
{ git diff --name-only; git ls-files --others --exclude-standard; } | sort -u \
  | comm -13 "$GITDIR/autodev_baseline.txt" - > "$LIST"

# Split off sensitive files (warn, never stage). No mapfile/arrays — must run on bash 3.2 and zsh.
grep -E '\.env$|(^|/)secrets|(^|/)credentials' "$LIST" | sed 's/^/Skipping sensitive file: /'
grep -Ev '\.env$|(^|/)secrets|(^|/)credentials' "$LIST" > "${LIST}.safe" || true

if [ -s "${LIST}.safe" ]; then
  git add --pathspec-from-file="${LIST}.safe" \
    || echo "[autodev:newfeature] Warning: some Feature ${K} files could not be staged"
  # Stat scoped to this feature's files only (NUL-delimited — safe for any filename)
  tr '\n' '\0' < "${LIST}.safe" | xargs -0 git diff --cached --stat --
else
  echo "[autodev:newfeature] Warning: Feature ${K} changed nothing — build may be a no-op. Skipping stage."
fi
```

Log and track for FP-End (`feature_status[K] = staged|no-op|skipped`, `feature_review[K] = clean|capped|n/a`):
```
[autodev:newfeature] Feature <K>/<newfeature_count> staged: <title>
Status: <staged|no-op|skipped>   # staged=changes in index, no-op=built but no diff, skipped=build failed
Review: <clean|capped>
Files changed: <stat output above>
```

Suggest a commit message (print it, do not run it):
```
feat(<entry_point_module>): <title>

<user_value>

Delivered by mastermind:autodev --newfeature
```

```
mcp__monomind__memory_store(
  content: "autodev newfeature built: <title> — <user_value>. Status: <status>.",
  namespace: "mastermind:autodev",
  tags: ["autodev", "newfeature", "built", status]
)
```

### FP-End — Summary

```bash
GITDIR=$(git rev-parse --git-dir)
rm -f "$GITDIR"/autodev_baseline.txt "$GITDIR"/autodev_feature_*.txt "$GITDIR"/autodev_feature_*.txt.safe
```

`staged_count` = features with `feature_status == "staged"`. Print:

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

## Standalone Execution

1. Extract flags (see Flag Parsing)
2. Load brain context via _protocol.md Brain Load Procedure (namespace: `autodev`)
3. Create monotask board (optional — skip gracefully if monotask is not installed):
   ```bash
   project_name="${project_name:-$(basename "$PWD")}"
   board_id=$(monotask board create "autodev" --json 2>/dev/null | jq -r '.id // empty')
   [ -z "$board_id" ] && echo "[autodev] monotask board unavailable — board tracking skipped."
   ```
4. `--newfeature` parsed → run the Feature Pipeline; otherwise run the Improvement Loop
5. At end: follow _protocol.md Brain Write Procedure (namespace: `autodev`)

---

## Tillend Integration

`--newfeature` is incompatible with `--tillend` (stripped with a warning at parse time — the pipeline delivers a fixed shortlist, which doesn't map onto the per-wakeup session model `--tillend` assumes).

For the improvement loop: each `--tillend` wakeup runs a full autodev session (`count` improvements per session). Memory deduplication (R1's `"autodev built"` search) prevents re-picking prior work across wakeups. The loop terminates naturally on an empty round — when Phase 1 finds no viable new candidates.

---

## Safety Guards

- Never delete files unless the improvement or feature explicitly requires it
- Never modify `.env`, secrets, credentials
- Never commit (only stage) — leave commit to the user
- Never use `git add --all` in feature mode — stage only the baseline-delta file list from Phase D
- If all research candidates are infeasible: ask the user for a focus direction instead of guessing
- Feature-mode phase failures degrade gracefully: build failure → skip feature; review failure → treat as capped; docs failure → inline fallback, then log and continue; per-file `git add` failure → log it, stage the rest
- Features must be genuinely new — reject candidates that are refactors or bugfixes of existing code
- Do not create standalone `.md` doc files unless the project already has a `/docs` directory
