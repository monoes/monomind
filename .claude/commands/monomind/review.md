---
name: monomind:review
description: "Monomind — Multi-agent iterative review loop: runs Code Reviewer, Security Engineer, and domain specialists in parallel, auto-fixes findings each iteration, and captures human-in-loop items to a dated file."
---

If `$ARGUMENTS` is empty or not a positive integer, output this and STOP:

> **Usage:** `/monomind:review <iterations>`
>
> Examples:
> - `/monomind:review 1` — single review pass
> - `/monomind:review 3` — three fix-and-re-review cycles
>
> Runs parallel review agents each iteration, auto-fixes what can be fixed, and saves items requiring human judgment to `humaninloopreview-YYYY-MM-DD.md`.

Do NOT proceed further if no valid number was provided.

---

## Terminology

- **Finding**: An issue reported by any review agent.
- **Auto-fixable**: Claude can apply the fix without ambiguity and without changing intended behavior.
- **Human-in-loop (HIL)**: Requires a product/design/architecture decision, a credential, a policy choice, or something Claude cannot safely assume. These are written to the HIL file and skipped.
- **HIL file**: `humaninloopreview-<YYYY-MM-DD>.md` in the project root. Appended each loop; never overwritten.

---

## Step 0: Setup

Parse `$ARGUMENTS` as `TOTAL_ITERATIONS` (integer, min 1, max 10).

Collect the following in parallel:

1. **Git context**: Run `git diff --name-only HEAD~1 HEAD 2>/dev/null || git ls-files --modified` to get recently changed files. Store as `CHANGED_FILES`.
2. **Repo structure**: Run `git ls-files | head -80` to get a representative file list. Store as `FILE_LIST`.
3. **Branch info**: Run `git log --oneline -5` to get recent commit context. Store as `RECENT_COMMITS`.
4. **Stack detection**: Run `ls package.json pyproject.toml go.mod Cargo.toml 2>/dev/null; find . -maxdepth 3 \( -name "*.swift" -o -name "*.kt" \) | head -3` to detect language/framework. Store detected stacks as `STACK`.
5. **HIL file path**: Compute `HIL_FILE=humaninloopreview-$(date +%Y-%m-%d).md` in the project root.

Initialize tracking state:
```
ITERATION = 1
ALL_FINDINGS = []        # accumulated across iterations
ALL_FIXED = []           # auto-fixed items
ALL_HIL = []             # human-in-loop items
```

---

## Step 1: Select Review Agents for This Stack

Based on `STACK`, determine which specialist agents to run beyond the always-on core set.

**Always run (every stack):**
- `Code Reviewer` — correctness, maintainability, performance, naming, dead code
- `Security Engineer` — injection, auth gaps, secrets exposure, CVE-prone patterns, OWASP Top 10
- `Reality Checker` — evidence-based assessment: does the code actually do what it claims?

**Run conditionally:**
- `Accessibility Auditor` — if HTML, JSX, TSX, or Swift UI files are present
- `API Tester` — if REST/GraphQL route handlers or OpenAPI specs are present
- `Database Optimizer` — if ORM models, SQL queries, or migration files are present
- `SRE` — if Dockerfile, CI/CD configs, or infrastructure-as-code files are present
- `Mobile App Builder` — if React Native, Swift, or Kotlin files are present

Store the selected set as `ACTIVE_REVIEWERS`.

---

## Loop: Run `TOTAL_ITERATIONS` times

For each iteration:

---

### Step 2: Run All Reviewers in Parallel

Spawn one agent per reviewer in `ACTIVE_REVIEWERS` using the `Task` tool — all in a **single message** so they run concurrently.

Each agent receives:
- `CHANGED_FILES`, `FILE_LIST`, `RECENT_COMMITS`, `STACK`
- The list of findings already auto-fixed in prior iterations (so they don't re-report them)
- The list of HIL items already deferred (same reason)
- Their specific review focus (below)

#### Agent Instructions by Role

All agent prompts share this finding schema. `hil_reason` is only required when `auto_fixable: false`:
```
{ file, line, severity: critical|high|medium|low, category: "...", description, suggested_fix, auto_fixable: true|false, hil_reason?: "only if auto_fixable=false" }
```

**Code Reviewer prompt:**
> Review the codebase for: logic errors, off-by-one bugs, null/undefined handling, dead code, overly complex functions (>50 lines or >3 nesting levels), naming inconsistencies, missing error propagation, and performance anti-patterns (N+1, blocking I/O, unnecessary allocations). Focus on `CHANGED_FILES` first, then related files. Return findings using the shared schema above.

**Security Engineer prompt:**
> Audit for: hardcoded secrets or API keys, SQL/command/path injection, missing input validation at system boundaries, insecure deserialization, broken auth/authz, sensitive data in logs, unpatched dependency versions with known CVEs, missing rate limiting on public endpoints, and CORS misconfigurations. Categories: injection|secrets|auth|deps|logging|config. Return findings using the shared schema above.

**Reality Checker prompt:**
> Check: does each function do what its name/docs claim? Are there missing test assertions? Are there commented-out code blocks, TODO/FIXME/HACK markers, or debug statements left in? Are there import cycles? Are env vars assumed to exist without validation? Categories: correctness|tests|debt|env. Return findings using the shared schema above.

**Accessibility Auditor prompt (if applicable):**
> Check: missing alt text, non-semantic HTML, keyboard-inaccessible interactive elements, insufficient color contrast (< 4.5:1 for text), missing ARIA labels, focus trap issues, and missing skip navigation. Category: a11y. Return findings using the shared schema above.

**API Tester prompt (if applicable):**
> Check: endpoints missing auth middleware, routes with no input validation, missing HTTP status codes on error paths, inconsistent response shapes, pagination not implemented where expected, and missing rate-limit headers. Category: api. Return findings using the shared schema above.

**Database Optimizer prompt (if applicable):**
> Check: missing indexes on foreign keys and frequently-queried columns, N+1 query patterns in ORM code, unparameterized queries, missing transactions around multi-step writes, and schema column type mismatches. Category: database. Return findings using the shared schema above.

**SRE prompt (if applicable):**
> Check: Docker images without pinned versions, CI jobs with no timeout, missing health check endpoints, hardcoded environment assumptions (localhost, fixed ports), missing retry logic on external calls, and secrets in CI config files. Categories: reliability|infra. Return findings using the shared schema above.

**Mobile App Builder prompt (if applicable):**
> Check: missing permission explanations, sensitive data stored in plain UserDefaults/SharedPreferences, missing loading/error states, hard-coded URLs, deprecated API usage, and missing offline/degraded-mode handling. Category: mobile. Return findings using the shared schema above.

---

### Step 3: Merge and Deduplicate Findings

Collect all agent outputs. Merge into a single `ITERATION_FINDINGS` list. Deduplicate by `(file, line, category)` — keep highest severity when duplicates exist. Exclude anything already in `ALL_FIXED` or `ALL_HIL`.

Sort by severity: critical → high → medium → low.

---

### Step 4: Classify and Act

For each finding in `ITERATION_FINDINGS`:

**If `auto_fixable: true`:**
- Apply the fix using `Edit` (or `Write` for new files). Track the file path as `FIXED_FILE`.
- Verify with whichever commands exist for the stack:
  ```bash
  npm run lint --if-present 2>&1 | tail -5
  npm run typecheck --if-present 2>&1 | tail -5
  npm test --if-present 2>&1 | tail -10
  ```
- If all checks pass (exit 0 or `--if-present` skipped): add to `ALL_FIXED`.
- If any check fails: restore the file with `git restore FIXED_FILE`, then add to `ALL_HIL` with `hil_reason: "auto-fix caused verification failure: <error output>"`.

**If `auto_fixable: false` (HIL):**
- Add to `ALL_HIL`. Do NOT attempt to fix.

---

### Step 5: Commit Fixes for This Iteration

If `ALL_FIXED` gained any new entries this iteration:

Stage only the files that were actually edited (tracked from `FIXED_FILE` values collected in Step 4):
```bash
git add <space-separated list of FIXED_FILE paths>
```

Then commit with each fixed item on its own line in the body:
```bash
git commit -m "fix(review): iteration N — M findings fixed by monomind:review

<file>:<line> — <description>
<file>:<line> — <description>

Co-Authored-By: nokhodian <nokhodian@gmail.com>"
```

---

### Step 6: Write HIL Items to File

If any new HIL items were added this iteration, **append** to `HIL_FILE`:

```markdown
## Review Iteration $ITERATION — <YYYY-MM-DD HH:MM>

<!-- One block per HIL finding -->
### HIL-<N>: <description> [`<severity>`]

**File:** `<file>:<line>`
**Category:** <category>
**Reported by:** <agent name>

**Context:**
<2-4 sentences of full context: what the code does, why this is a problem, what the risk is>

**Suggested fix:**
<suggested_fix from agent, verbatim>

**Why human decision needed:**
<hil_reason>

**Your options:**
- [ ] Apply the suggested fix as-is
- [ ] Apply a modified fix (describe below)
- [ ] Defer — not a priority right now
- [ ] Reject — not applicable for this project

**Your response (fill in and save):**
> 

---
```

After writing, print:
> `HIL_FILE` updated with N new items requiring human judgment.

---

### Step 7: Iteration Summary

Print a table:

```
### Iteration $ITERATION / $TOTAL_ITERATIONS

| Reviewer            | Findings | Auto-Fixed | HIL |
|---------------------|----------|------------|-----|
| Code Reviewer       | N        | N          | N   |
| Security Engineer   | N        | N          | N   |
| Reality Checker     | N        | N          | N   |
| ...                 | ...      | ...        | ... |
| **Total**           | **N**    | **N**      | **N**|

Severity breakdown: X critical, Y high, Z medium, W low
```

If zero findings remain after dedup and exclusions, print:
> No new findings. Review complete.
> Break out of the loop early.

Increment `ITERATION`. Continue to next iteration.

---

## Step 8: Final Report

After all iterations complete (or early exit), output:

```markdown
## monomind:review — Complete

**Iterations run:** N / $TOTAL_ITERATIONS
**Reviewers active:** <list>

### Auto-Fixed (<N> total)
| File | Line | Severity | Category | Description |
|------|------|----------|----------|-------------|
| ... | ... | ... | ... | ... |

### Human-in-Loop (<N> items)
Saved to: `humaninloopreview-<date>.md`

| # | File | Severity | Category | Why HIL |
|---|------|----------|----------|---------|
| 1 | ... | ... | ... | ... |

### How to resolve HIL items
1. Open `humaninloopreview-<date>.md`
2. For each item, fill in **Your response** and check the option box
3. Apply your chosen fixes manually, or run `/monomind:review 1` again after fixing to re-verify

### Commits created
<list of commit SHAs and messages from this session>
```

If `ALL_HIL` is empty, omit the HIL section and congratulate:
> All findings were auto-fixed. No human decisions required.
