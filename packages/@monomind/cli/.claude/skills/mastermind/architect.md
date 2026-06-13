---
name: mastermind-architect
description: Mastermind architect domain — architecture review, file structure deduplication, dependency analysis, coupling detection, design pattern audit, and system design recommendations. Spawns an Architecture Manager coordinating specialist architect agents.
type: domain-skill
default_mode: confirm  # intentional — architecture changes have high blast radius; always show plan before executing
---

# Mastermind Architect Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:architect`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: what to architect, review, or redesign
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm
- `scope`: optional — `review` | `design` | `deduplicate` | `migrate` | `all` | `review+deduplicate` (default: inferred from prompt). `review+deduplicate` is an internal compound scope used by the Iteration Loop — it runs both the review and deduplicate phases (skips design and migrate), equivalent to a partial `all`. It is never set by the user directly.
- `stack`: optional — detected tech stack hint (e.g. `typescript`, `python`, `react`, `rails`, `go`)
- `sessionId`: session ID for dashboard events — injected by master as `mm-<YYYYMMDDTHHmmss>`; generated locally for standalone runs (see Standalone Execution)
- `caller`: optional — `command` | `master` | `standalone` (default: `standalone`) — controls whether the skill runs the Brain Write Procedure at the end
- `iterate`: optional — integer ≥ 1 (default: 0 = no iteration) — number of autonomous fix+review cycles to run after the initial architect pass

---

## Mode Branching

**Before complexity assessment**, check `mode`:

- `mode: confirm` (default): After complexity assessment and before spawning any agent, present the architecture plan to the caller — describe the scope inferred, the streams planned, the agents to be spawned, and the phase sequence (for `scope: all`). Wait for the caller to say "go", "proceed", or similar before spawning. If the caller modifies the plan, update accordingly.
- `mode: auto`: Skip the confirmation step and proceed directly to agent spawning.

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Narrow, single-surface question:
- "Is this file structure flat enough?"
- "Should this function be in a service or a repository?"
- "What pattern fits this use case?"
→ Use a single Software Architect agent. Skip manager delegation.

**Complex (spawn Architecture Manager):** Any of these:
- Full codebase architecture audit
- File structure deduplication + consolidation plan
- Cross-module dependency or coupling analysis
- Multi-layer design (API + domain + infra + data)
- Migration plan (monolith → microservices, REST → GraphQL, etc.)
- Greenfield system design from requirements
- DDD bounded context mapping
→ Spawn Architecture Manager agent with full briefing.

**Override:** If `scope == all`, always route to Complex Execution regardless of prompt shape.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. If `sessionId` was not provided by the caller: generate it by taking the current UTC datetime formatted as `YYYYMMDDTHHmmss` and prefixing with `mm-` (e.g. `mm-20260506T142345`). Then emit `session:start` (if `caller` is `standalone` — skip if `command` or `master`, as the caller emits it). Before executing the curl below, substitute the generated sessionId for `<sessionId>`:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d '{"type":"session:start","session":"<sessionId>","domain":"architect","ts":'"$(date +%s)"'000}' || true
   ```
2. Load brain context following _protocol.md Brain Load Procedure (namespace: `architect`)
3. Run intake from _intake.md if prompt is vague
4. Detect stack from current directory:
   ```bash
   # Detect tech stack
   ls package.json pyproject.toml go.mod Cargo.toml pom.xml build.gradle mix.exs Gemfile 2>/dev/null
   # Count files per extension to determine dominant stack
   find . \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
     -o -name "*.vue" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \
     -o -name "*.rb" -o -name "*.java" -o -name "*.ex" -o -name "*.exs" \
     -o -name "*.swift" -o -name "*.kt" -o -name "*.cs" -o -name "*.cpp" \
     -o -name "*.gd" \) \
     -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \
     | awk -F. '{print $NF}' | sort | uniq -c | sort -rn | head -10
   ```
   After the bash above completes, apply the 60% classification rule: sum the total file count across all extensions. If any single extension group exceeds 60% of the total, set `<stack>` to that stack's name (e.g. `typescript`, `python`, `go`); otherwise set `<stack>` to `multi-stack`. Use this value for `Stack: <stack>` in all subsequent briefings.
   If `scope` was not provided by the caller, infer it from the prompt: "review"/"audit"/"check"/"assess" → `review`; "deduplicate"/"dedup"/"consolidate" → `deduplicate`; "design"/"architect"/"model"/"bounded context" → `design`; "migrate"/"migration"/"port to"/"convert" → `migrate`; no keyword match or multiple keyword matches → `all`. Use the resolved scope for all subsequent steps.
5. If `board_id` was not provided by the caller: find or create monotask space `<project_name>`, then create board `architect` within it. Before executing the bash block below, substitute the resolved `project_name` (or `basename "$PWD"` if not provided) for every `<project_name>` occurrence:
   ```bash
   space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="<project_name>" '$2==n{print $1}' | head -1)
   [ -z "$space_id" ] && space_id=$(monotask space create "<project_name>" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
   result=$(monotask board create "architect" --json 2>/dev/null)
   board_id=$(echo "$result" | jq -r '.id // empty')
   [ -n "$board_id" ] && [ -n "$space_id" ] && monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
   [ -z "$board_id" ] && { echo "[mastermind] monotask board unavailable — board tracking skipped."; board_tracking=false; }
   echo "${board_id:-}"
   ```
   If board_id is empty after this block, set `board_tracking=false` and continue — do not abort. Card creation steps later are skipped when `board_tracking=false`.
6. Proceed with complexity assessment below
7. At end: emit `session:complete` (if `caller` is `standalone`). Before executing the curl below, substitute the resolved sessionId for `<sessionId>`:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d '{"type":"session:complete","session":"<sessionId>","domain":"architect","ts":'"$(date +%s)"'000}' || true
   ```
   Then: if `caller` is `standalone` (default), follow _protocol.md Brain Write Procedure (namespace: `architect`). If `caller` is `command` or `master`, skip — the caller handles the brain write.

---

## Stack Detection & Specialist Routing

After detecting the stack, route to the appropriate specialist lens. If no single extension group exceeds 60% of total matched files, classify as **Multi-stack / Unknown** and use that row regardless of any individual extension count.

| Stack | Primary Architect Agent | Secondary Agents |
|---|---|---|
| TypeScript / Node.js | Software Architect | Backend Architect, Database Optimizer |
| Python / FastAPI / Django | Software Architect | Backend Architect, Database Optimizer |
| React / Next.js / Vue | Software Architect | Frontend Developer |
| Go | Software Architect | Backend Architect, SRE (Site Reliability Engineer) |
| Ruby on Rails | Software Architect | Backend Architect, Database Optimizer |
| Elixir / Phoenix | Software Architect | Backend Architect |
| Java / Spring | Software Architect | Backend Architect |
| Rust | Software Architect | Backend Architect |
| Mobile (React Native / Swift / Kotlin) | Mobile App Builder | Software Architect |
| Game (Unity) | Unity Architect | Game Designer |
| Game (Unreal) | Unreal Systems Engineer | Game Designer |
| Game (Godot) | Software Architect | Game Designer |
| Multi-stack / Unknown | Software Architect | Backend Architect, Database Optimizer |

---

## Architecture Review Checklist

When `scope` includes `review`, evaluate ALL of the following dimensions:

### 1. File Structure & Organization
- [ ] Flat vs. deep nesting — flag directories deeper than 4 levels
- [ ] Duplicate functionality across files (same logic in 2+ places)
- [ ] Files that should be split (>500 lines, multiple concerns)
- [ ] Files that should be merged (tiny files <20 lines with trivial single-use exports)
- [ ] Barrel files (`index.ts`) hiding internals vs. exposing surface
- [ ] Naming inconsistency (camelCase vs snake_case vs kebab-case mixed)
- [ ] Test files co-located vs. separate `__tests__` / `spec` directory — flag if placement is inconsistent across the project (mixing both conventions is the issue; either approach alone is acceptable)

### 2. Dependency & Coupling
- [ ] Circular imports / circular dependencies
- [ ] God modules (one file imported by >15 others)
- [ ] High afferent coupling (many dependents → risky to change)
- [ ] High efferent coupling (depends on many → fragile)
- [ ] Direct database access outside repository/data layer
- [ ] Business logic leaking into controllers, routes, or UI
- [ ] Hardcoded dependencies (no injection, no interface)

### 3. Design Patterns
- [ ] Repository pattern applied to data access?
- [ ] Service layer separating business logic from transport?
- [ ] Factory or Builder for complex object creation?
- [ ] Strategy pattern where switch/if-else chains appear on type
- [ ] Observer/Event bus for cross-module communication?
- [ ] Anti-patterns present: God Object, Anemic Domain Model, Shotgun Surgery, Feature Envy

### 4. Domain-Driven Design
- [ ] Bounded contexts identified and respected?
- [ ] Domain models free of infrastructure concerns?
- [ ] Aggregates enforce invariants?
- [ ] Domain events for cross-context communication?
- [ ] Ubiquitous language consistent in naming?

### 5. API Design
- [ ] REST: resource-based, consistent naming, correct HTTP verbs and status codes
- [ ] Input validation at boundary (not inside domain)?
- [ ] Error contracts consistent and typed?
- [ ] Versioning strategy present?
- [ ] Auth/authz consistent across endpoints?

### 6. Data Layer
- [ ] N+1 query risks
- [ ] Missing indexes on frequently queried fields
- [ ] Schema migration strategy
- [ ] Connection pooling configured
- [ ] Sensitive data in logs or error messages

### 7. Observability & Operations
- [ ] Structured logging with correlation IDs
- [ ] Health check endpoints
- [ ] Metrics instrumentation
- [ ] Graceful shutdown handling
- [ ] Error boundaries / recovery paths

### 8. Security Architecture
- [ ] Input validation at all external boundaries
- [ ] Secrets in environment variables, not source
- [ ] Dependency audit (`npm audit`, `pip-audit`, `cargo audit`)
- [ ] Auth middleware applied consistently
- [ ] CORS / rate limiting configured

---

## File Structure Deduplication Procedure

When `scope` includes `deduplicate`:

```bash
# Shared extension set used by steps 1-4 (mirrors stack detection list)
# Outer parens make this a bash array; inner \( \) become a find grouping expression
_EXTS=( \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -o -name "*.vue" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \
  -o -name "*.rb" -o -name "*.java" -o -name "*.ex" -o -name "*.exs" \
  -o -name "*.swift" -o -name "*.kt" -o -name "*.cs" -o -name "*.cpp" \
  -o -name "*.gd" \) )

# 1. Find duplicate file names across the tree (excludes dist, node_modules, .git, test/spec dirs)
# Uses -not -path for macOS/BSD portability (grep -z is GNU-only)
find . -type f "${_EXTS[@]}" \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \
  -not -path "*/__tests__/*" -not -path "*/spec/*" \
  | awk -F/ '{print $NF}' \
  | sort | uniq -d | head -30

# 2. Find files with identical content (exact duplicates)
# openssl md5 output: "MD5(path)= hash" — awk groups all lines by hash ($NF) and prints every
# file in a duplicate group (all occurrences when count > 1, so both files in a pair are shown)
find . -type f "${_EXTS[@]}" \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \
  -print0 | xargs -0 openssl md5 2>/dev/null \
  | awk '{hash=$NF; files[hash]=files[hash] " " $0; count[hash]++}
         END {for (h in count) if (count[h]>1) print files[h]}' | head -20

# 3. Find very small files that may be consolidation candidates
find . -type f "${_EXTS[@]}" \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \
  -not -path "*/__tests__/*" -not -path "*/spec/*" \
  -print0 | xargs -0 wc -l 2>/dev/null | grep -v ' total$' | sort -n | awk '$1 > 0 && $1 < 20 {print}' | head -20

# 4. Find oversized files that need splitting (also excludes test/spec dirs)
find . -type f "${_EXTS[@]}" \
  -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \
  -not -path "*/__tests__/*" -not -path "*/spec/*" \
  -print0 | xargs -0 wc -l 2>/dev/null | sort -rn | grep -v ' total$' | head -20

# 5. Detect circular dependencies (TypeScript/JS)
# Auto-detect entry dir: prefer src/, app/, lib/ over packages/ (avoid monorepo root scan)
for _d in src app lib packages; do [ -d "$_d" ] && _entry="$_d" && break; done
_entry=${_entry:-.}
{ npx --yes madge --circular --ts-config tsconfig.json "$_entry/" 2>/dev/null || \
  npx --yes madge --circular "$_entry/" 2>/dev/null; } | head -20

# 6. Find god files (imported by many others)
# NOTE: This step covers JS/TS/Vue and Python only.
# For Go, Rust, Java, and other stacks, use mcp__monomind__monograph_god_nodes instead.
# JS/TS/Vue: skip comment lines; perl extracts module name from from '...' or from "..."
# --exclude-dir applied at grep level so exclusions work before -h strips filenames
grep -rh "^[^/]*from ['\"]" . \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.vue" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null \
  | perl -ne 'if (/from\s+['"'"'"]([^'"'"'"\s]+)['"'"'"]/) { print "$1\n" }' \
  | sort | uniq -c | sort -rn | head -20
# Python: count imports separately (no quotes in Python import syntax)
grep -rh "^from \|^import " . --include="*.py" \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.git \
  2>/dev/null \
  | awk '{print $2}' | sed 's/,.*//' | sed 's/\..*//' | grep -v '^$' | sort | uniq -c | sort -rn | head -20
# Note: if monograph is built, prefer mcp__monomind__monograph_god_nodes — it uses the pre-computed graph index
```

For each finding, produce a **Deduplication Action Table**:

| File | Issue | Action | Risk |
|---|---|---|---|
| `src/utils/helpers.ts` | Duplicate of `src/lib/helpers.ts` | Merge into `src/lib/helpers.ts`, update 3 imports | Low |
| `src/controllers/user.ts` | 847 lines, 3 concerns | Split into UserController + UserQueryController + UserMutationController | Medium |

---

## Complex Execution — Architecture Manager Agent

Before spawning, resolve two values:

**Manager subagent_type** (based on detected stack):
- Mobile (React Native / Swift / Kotlin) → `Mobile App Builder`
- Game (Unity) → `Unity Architect`
- Game (Unreal) → `Unreal Systems Engineer`
- All other stacks → `Software Architect`

**Current UTC date**: run `date -u +%Y-%m-%d` in Bash and substitute the output for every `<current UTC date YYYY-MM-DD>` placeholder in the briefing below.

Then emit `agent:spawn` for the manager and spawn it. Before executing the curl below, substitute the resolved sessionId for `<sessionId>`:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"agent:spawn","session":"<sessionId>","domain":"architect","agent":"<manager_agent_type lowercased and hyphenated, e.g. software-architect>","task":"coordinate architecture analysis","ts":'"$(date +%s)"'000}'
```

Before constructing the Task() string, substitute the following into the template:
- `<project_name>` → resolved project name
- `<sessionId>` → the sessionId resolved in Standalone Execution or passed by caller
- `<current UTC date YYYY-MM-DD>` → output of `date -u +%Y-%m-%d` (already run above)
- `<mode>` → resolved mode value (`auto` or `confirm`)
- `<board_id>` → resolved board_id value
- `<manager_agent_type>` → agent type resolved above (also used in `subagent_type:`)
- `<scope>` → resolved scope, or fallback text `"inferred from prompt in STEP 2"` if not yet known
- `<stack>` → resolved stack, or fallback text `"auto-detect in STEP 1"` if not yet known
- `<prompt>` → caller's prompt — strip double-quotes and backslashes for JSON safety, then escape backtick characters as `` \` `` and replace `${` with `\${` for template-literal safety
- `<brain_context>` → injected brain context — apply the same backtick and `${` escaping

```javascript
Task({
  subagent_type: "<manager_agent_type>",
  description: `You are the Architecture Manager for project <project_name>.

CONTEXT: <current UTC date YYYY-MM-DD> | Session: <sessionId> | Mode: <mode> | Project: <project_name> | Requested stack hint: <stack if provided by caller, else "auto-detect in STEP 1"> | Scope: <scope if provided, else "inferred from prompt in STEP 2"> | Spawned by: mastermind:architect

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>
SCOPE: <scope>

STEP 1 — ORIENT
Detect the tech stack and project structure:

\`\`\`bash
ls package.json pyproject.toml go.mod Cargo.toml pom.xml build.gradle mix.exs Gemfile 2>/dev/null
find . -maxdepth 3 -type d | grep -Ev "(^|/)(node_modules|dist|\\.git)(/|$)" | head -40
find . \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\
  -o -name "*.vue" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \\
  -o -name "*.rb" -o -name "*.java" -o -name "*.ex" -o -name "*.exs" \\
  -o -name "*.swift" -o -name "*.kt" -o -name "*.cs" -o -name "*.cpp" \\
  -o -name "*.gd" \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" \\
  | awk -F. '{print $NF}' | sort | uniq -c | sort -rn | head -10
\`\`\`

After STEP 1 completes: sum the total file count across all extensions. If any single extension group accounts for >60% of the total, classify the stack using that extension's row in the Stack Detection table. If no single extension exceeds 60%, classify as Multi-stack / Unknown. Set the `<stack>` placeholder to the resolved value (e.g. "typescript", "python", "go", "multi-stack"). Use this value for every `<stack>` occurrence in all STEP 3 task briefings below.

(Duplicate detection and god-file analysis will be delegated to sub-agents in STEP 3 — no further action needed here.)

STEP 2 — PLAN
**If scope was not pre-resolved by the caller:** infer it from the prompt — "review"/"audit"/"check"/"assess" → `review`; "deduplicate"/"dedup"/"consolidate" → `deduplicate`; "design"/"architect"/"model"/"bounded context" → `design`; "migrate"/"migration"/"port to"/"convert" → `migrate`; multi-match or no match → `all`. Set `<scope>` to the resolved value and use it throughout all subsequent STEPs.

Decompose the architecture goal into parallel specialist streams based on scope:

- **review**: structure, coupling, patterns, DDD, API design, data, observability, security
- **deduplicate**: exact duplicates, oversized files, undersized files, circular deps, god files
- **design**: bounded contexts, layer boundaries, interface contracts, data model
- **migrate**: current-state mapping, target-state design, migration sequence, risk assessment
- **all**: run all four streams — review first (establishes baseline), then deduplicate, then design for any unaddressed gaps, then migrate if a migration target is identified from the design phase
- **review+deduplicate**: run only review and deduplicate streams in sequence (same as `all` phases 1–2; skip design and migrate). Used by the Iteration Loop for re-review cycles on `scope: all` runs.

For each stream, identify:
- Which dimension of the checklist it covers
- Which specialist agent is most suited (see Stack Detection table)
- What concrete artifacts it must produce (diagram, action table, ADR, etc.)
- Dependencies between streams (e.g. coupling analysis before deduplication plan)

STEP 3 — CREATE TASKS
For each architecture stream, create a monotask card on the project board. First resolve column IDs (slash commands are not available inside background Task agents — use bash directly):

\`\`\`bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_TODO_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Todo" or .title == "Backlog") | .id' | head -1)
COL_DONE_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Done") | .id' | head -1)
\`\`\`

Then create the card:

\`\`\`bash
result=$(monotask card create "$BOARD_ID" "$COL_TODO_ID" "<short summary of architecture stream goal, ≤80 chars>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "$BOARD_ID" "$CARD_ID" "[specific architecture dimension to assess or design]"
monotask card comment add "$BOARD_ID" "$CARD_ID" "CONTEXT: <current UTC date YYYY-MM-DD> | Session: <sessionId> | Project: <project_name> | Stack: <stack> | Created by: Architecture Manager
BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
SCOPE: [exact files, modules, or surfaces in scope]
CHECKLIST: [specific items from the architecture review checklist to evaluate]
CONSTRAINTS: [existing decisions not to revisit, performance budgets, team skill constraints]
SUCCESS CRITERIA:
- [ ] [e.g. all circular deps mapped with import paths]
- [ ] [e.g. deduplication action table with risk ratings]
- [ ] [e.g. ADR written for each major design decision]
AGENT: [Software Architect | Backend Architect | Database Optimizer | Frontend Developer | SRE (Site Reliability Engineer)]
SWARM: [consult Domain Swarm Defaults table — e.g. mesh 3 gossip for coupling analysis, hive-mind byzantine for security]
DEPENDENCIES: [task IDs or none]
OUTPUT FORMAT:
  findings:
    - severity: CRITICAL | HIGH | MEDIUM | LOW
      dimension: [checklist dimension, e.g. 2. Dependency & Coupling]
      description: [one-sentence description of the issue]
      affected: [files or modules impacted]
      recommendation: [specific actionable fix]
  summary: [one-paragraph overview of findings for this stream]
  artifacts: [list of files written to disk, or empty list]
  confidence: [0.0-1.0 - how complete the coverage was for this stream]"
\`\`\`

STEP 4 — EXECUTE
The caller already confirmed the plan before spawning this manager — proceed directly to spawning all specialist agents for the current phase.

**For single-scope runs** (`review`, `deduplicate`, `design`, or `migrate`): spawn all relevant agents in parallel.

**For `scope: all`**: execute streams sequentially in phases:
- Phase 1 (parallel): review streams → wait for completion. Phase 1 always runs under `scope: all` — there is no skip condition.
  - After Phase 1 completes: call `mcp__monomind__memory_store` (namespace: `architect:<sessionId>`, key: `phase1_findings`, value: summarized Phase 1 output). Record `review` in `phases_run`.
  - Before starting Phase 2: call `mcp__monomind__memory_retrieve` (namespace: `architect:<sessionId>`, key: `phase1_findings`) to retrieve the stored findings. Inject verbatim into every Phase 2 task briefing under a `PRIOR PHASE FINDINGS:` section. If Phase 1 findings are empty, write "Phase 1 produced no findings — proceed without prior context" under that section rather than leaving it blank.
- Phase 2 (parallel, uses Phase 1 findings as input): deduplicate streams. Phase 2 always runs under `scope: all` — there is no skip condition.
  - After Phase 2 completes: call `mcp__monomind__memory_store` (namespace: `architect:<sessionId>`, key: `phase2_findings`). Record `deduplicate` in `phases_run`.
  - Before starting Phase 3: call `mcp__monomind__memory_retrieve` (namespace: `architect:<sessionId>`) for `phase1_findings` and `phase2_findings`. Inject both into every Phase 3 briefing under `PRIOR PHASE FINDINGS:`. If a retrieve returns empty, substitute "No findings from Phase N."
  - **Phase 3 runs only if Phase 2 identified gaps** (files flagged for redesign, missing abstractions, or unresolved coupling issues). If no gaps are found, skip Phase 3, record "design — Phase 2 found no gaps" in `phases_skipped`, and proceed to Phase 4 evaluation.
- Phase 3 (parallel, conditional on Phase 2 gaps): design streams
  - After Phase 3 completes: call `mcp__monomind__memory_store` (namespace: `architect:<sessionId>`, key: `phase3_findings`). If a migration target was identified, also store it (namespace: `architect:<sessionId>`, key: `migration_target`). Record `design` in `phases_run`.
  - Before starting Phase 4: call `mcp__monomind__memory_retrieve` (namespace: `architect:<sessionId>`, key: `migration_target`). If the result is empty or absent, skip Phase 4 and record "migrate — Phase 3 did not run or identified no migration target" in `phases_skipped`. Otherwise also retrieve `phase1_findings`, `phase2_findings`, `phase3_findings` (namespace: `architect:<sessionId>`) and inject all four values into every Phase 4 briefing (prior findings under `PRIOR PHASE FINDINGS:`, migration target under `MIGRATION TARGET:`). Substitute "No findings from Phase N." for any prior-findings retrieves that return empty.
  - **Phase 4 runs only if Phase 3 stored a non-empty `migration_target`**.
- Phase 4 (spawn ONLY if Phase 3 identifies a migration target): migrate streams
  - After Phase 4 completes: call `mcp__monomind__memory_store` (namespace: `architect:<sessionId>`, key: `phase4_findings`, value: summarized Phase 4 output). Record `migrate` in `phases_run`.

Default agent routing (applies to all scopes). **Stack overrides**: for specialized stacks, replace ALL "Software Architect" rows with the primary agent from the Stack Detection table (e.g. Mobile App Builder replaces Software Architect across all streams for React Native/Swift/Kotlin). Keep domain-specific agents (Database Optimizer, Security Engineer, SRE) unchanged regardless of stack.

- Structure + dedup: subagent_type "Software Architect"
- Coupling + god files: subagent_type "Software Architect"
- Data layer: subagent_type "Database Optimizer"
- API surface: subagent_type "Backend Architect"
- Security posture: subagent_type "Security Engineer"
- Frontend architecture (if applicable): subagent_type "Frontend Developer"
- Observability: subagent_type "SRE (Site Reliability Engineer)"

For each specialist, spawn via the Claude Code Task tool using the full briefing text written in STEP 3 as the description. Spawn all specialists for the current phase in one message with `run_in_background: true`:
```javascript
Task({
  subagent_type: "<agent type from routing table above>",
  description: `<paste the full STEP 3 task briefing verbatim — not a summary>`,
  run_in_background: true
})
```
The `description` must be the complete briefing, including CONTEXT, BRAIN MEMORY, GOAL, SCOPE, CHECKLIST, CONSTRAINTS, SUCCESS CRITERIA, AGENT, SWARM, DEPENDENCIES, and OUTPUT FORMAT. Do NOT summarize.

BEFORE spawning each agent, emit agent:spawn to the live dashboard. Before each of the following curl commands executes, `<sessionId>` must already be substituted with the session ID from the CONTEXT header Session field above. When substituting `<stream-description>` and other free-text fields into the JSON payload, strip any double-quotes and backslashes from the value to keep the JSON well-formed:
\`\`\`bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"agent:spawn","session":"<sessionId>","domain":"architect","agent":"<subagent_type lowercased and hyphenated, e.g. software-architect>","task":"<stream-description>","ts":'"$(date +%s)"'000}'
\`\`\`

If handing off artifacts to another domain (e.g. build for refactoring implementation, review for post-restructure check), emit intercom. When substituting `<msg>` and other free-text fields, strip any double-quotes and backslashes from the value to keep the JSON well-formed:
\`\`\`bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"intercom","session":"<sessionId>","from":"architect","to":"<domain>","msg":"<msg>","ts":'"$(date +%s)"'000}'
\`\`\`

To track task execution, log progress via \`monotask card comment add "$BOARD_ID" "$CARD_ID" "<progress update>"\`. When a task is fully done, move the card to Done: \`monotask card move "$BOARD_ID" "$CARD_ID" "$COL_DONE_ID" --json\`.

BEFORE returning, emit domain:complete to the live dashboard:
\`\`\`bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d '{"type":"domain:complete","session":"<sessionId>","domain":"architect","status":"<choose: complete | partial | blocked>","artifacts":[],"decisions":[],"ts":'"$(date +%s)"'000}'
\`\`\`

STEP 5 — SYNTHESIZE
Collect all findings. Produce:
1. **Architecture Health Score** (0–100) by dimension — maps to `decisions` (one entry per dimension: `score` = health score 0–100, `confidence` = how certain the assessment is, e.g. 0.8 if based on full scan, 0.4 if partial)
2. **Deduplication Action Table** (if scope includes deduplicate) — maps to `artifacts` (write to disk as `architecture-dedup-action-table.md`; include path)
3. **Critical Issues List** (must-fix before next release) — maps to `next_actions` (each critical issue becomes a next_action prefixed with "[CRITICAL]")
4. **Recommended ADRs** (Architecture Decision Records for open decisions) — maps to `artifacts` (each ADR written to disk; include path) and `decisions` (one entry per ADR with the decision summary)
5. **Refactoring Roadmap** (prioritized by impact/effort matrix) — maps to `next_actions` (each roadmap item becomes a next_action in priority order)
6. **Lessons** — maps to `lessons`: set `what_worked` to which analysis streams surfaced the most actionable findings; set `what_didnt` to coverage gaps, streams that returned no findings, or streams blocked by missing tooling.
7. **Findings** — aggregate all `findings` arrays from every specialist task output into a top-level `findings` field, preserving the `{severity, dimension, description, affected, recommendation}` structure from the OUTPUT FORMAT. Include all severity levels (CRITICAL, HIGH, MEDIUM, LOW). This field is consumed by the Iteration Loop — do not omit it.

Return to caller:

domain: architect
status: <choose: complete | partial | blocked>
phases_run:
  - review      # always included for scope: all
  - deduplicate # always included for scope: all
  - design      # include only if Phase 2 identified gaps
  - migrate     # include only if Phase 3 stored migration_target
phases_skipped:
  - [e.g. "design — Phase 2 found no gaps"]
  - [e.g. "migrate — Phase 3 identified no migration target"]
artifacts:
  - path: [architecture report if written to disk]
    type: report
  - path: [ADR files if written]
    type: adr
  - path: [deduplication action table if written]
    type: table
decisions:
  - what: [architectural dimension or decision]
    why: [evidence and tradeoffs]
    score: [0–100 health score for dimension entries; null for ADR entries that have no numeric health dimension]
    confidence: [0.0–1.0 — certainty in this assessment or decision]
    outcome: pending
lessons:
  - what_worked: [which analysis streams surfaced the most value]
  - what_didnt: [gaps in coverage]
next_actions:
  - [e.g. "[CRITICAL] fix circular dep between src/auth and src/user before next release"]
  - [e.g. "run mastermind:build to implement refactoring plan"]
  - [e.g. "run mastermind:review after restructuring is complete"]
findings:
  - severity: CRITICAL | HIGH | MEDIUM | LOW
    dimension: [checklist dimension, e.g. "2. Dependency & Coupling"]
    description: [one-sentence description of the issue]
    affected: [files or modules impacted]
    recommendation: [specific actionable fix]
  # ... one entry per finding aggregated from all specialist task outputs
board_url: monotask://<project_name>/architect   # substitute actual project_name before returning
session_id: <sessionId>   # substitute the sessionId value from the CONTEXT header Session field before returning

# Note for single-scope runs (review, deduplicate, design, or migrate only):
# set phases_run: [<scope>]
# set phases_skipped to the three scopes that were not run, one entry each. Example for scope=review:
#   - "deduplicate — not applicable for single-scope run"
#   - "design — not applicable for single-scope run"
#   - "migrate — not applicable for single-scope run"`,
  run_in_background: true
})
```

**If `iterate` ≥ 1:** After the Architecture Manager returns its output schema, the outer skill (not the manager) stores the initial findings and activity tag for the Iteration Loop:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_0_findings", value: <manager output schema findings serialized as JSON>)
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_0_activity", value: "review")
```
Then proceed to the Iteration Loop section.

---

## Simple Execution

For simple tasks (single specialist, single question):

**Before step 1:** Resolve the specialist agent from the Stack Detection table using the detected stack. For Mobile (React Native / Swift / Kotlin) use `Mobile App Builder`; for Game (Unity) use `Unity Architect`; for Game (Unreal) use `Unreal Systems Engineer`; for all other stacks use `Software Architect`. Use the resolved type for `subagent_type` in step 2 and the lowercased-hyphenated slug for the dashboard `agent:` field in step 1.

Before executing the curl blocks below and when constructing the Task() description, substitute the resolved sessionId for `<sessionId>`. When substituting `<prompt>` into the JSON payload below, strip any double-quotes and backslashes from the value to keep the JSON well-formed. When substituting `<prompt>` into the Task description template literal in step 2, additionally escape any backtick characters as `` \` `` and replace any `${` sequences with `\${` to prevent template-literal injection.

1. Emit `agent:spawn` to the dashboard (use the resolved agent slug):
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d '{"type":"agent:spawn","session":"<sessionId>","domain":"architect","agent":"<resolved agent slug, e.g. software-architect>","task":"<prompt>","ts":'"$(date +%s)"'000}'
   ```
2. Spawn one Task agent (`subagent_type: "<resolved agent type>"`) with a self-contained briefing. The briefing MUST include:
   ```
   CONTEXT: <current UTC date YYYY-MM-DD> | Session: <sessionId> | Project: <project_name> | Scope: <scope> | Stack: <stack>
   BRAIN CONTEXT: <relevant excerpts from brain_context>
   GOAL: <prompt>
   DIRECTORY STRUCTURE: <output of find below>
   ```
3. Include current directory structure context (`find . -maxdepth 3 -type d | grep -Ev "(^|/)(node_modules|dist|\.git)(/|$)"`)
4. Collect output, then emit `domain:complete`:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d '{"type":"domain:complete","session":"<sessionId>","domain":"architect","status":"complete","artifacts":[],"decisions":[],"ts":'"$(date +%s)"'000}'
   ```
5. Return the full unified output schema (same structure as Complex Execution STEP 5). Set `phases_run: [<scope>]`. Set `phases_skipped` to a separate entry for each of the three non-run scopes, naming each explicitly — e.g. for scope=design:
   ```yaml
   phases_skipped:
     - "review — not applicable for single-scope run"
     - "deduplicate — not applicable for single-scope run"
     - "migrate — not applicable for single-scope run"
   ```
   Set `artifacts: []` (unless the agent produced files), and populate `decisions` and `next_actions` from the single-agent output. Set `status: complete`. Set `lessons.what_worked` to what the single agent was able to assess; set `lessons.what_didnt` to what it was unable to cover (e.g. stacks not detected, missing tooling, phases not run).

**If `iterate` ≥ 1:** After returning the output schema, store the initial findings and activity tag for the Iteration Loop:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_0_findings", value: <output schema findings serialized as JSON>)
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_0_activity", value: "review")
```
Then proceed to the Iteration Loop section.

---

## Iteration Loop (only when `iterate` ≥ 1)

After the initial architect pass completes and its output schema is available, run up to `iterate` autonomous fix+review cycles. Each cycle alternates between **fix** (implement what the previous review found) and **review** (re-run architect to validate the fixes). Cycles never pause for user confirmation — always use `mode: auto` internally.

**Early-stop condition:** After a **review** cycle only, starting from cycle 2 — if `i > 1` AND `last_activity == "review"` AND CRITICAL + HIGH count == 0 (MEDIUM findings do not block early-stop), stop immediately: set `actual_cycles_run = i - 1` (cycle `i-1` was the last cycle that actually ran), skip the post-loop guard and the unresolved-issues checkpoint (count is 0 by definition), and report:
> "Architecture clean — no CRITICAL or HIGH findings remain. Halting at cycle \<i>/\<iterate>."
Then output the ITERATION COMPLETE block below using `Status: complete`, listing only the cycles that ran (i = 1 through `actual_cycles_run`), and set "Suggested next: all architecture findings resolved."
Cycle 1 always runs (never early-stop at i=1). Never early-stop after a fix cycle — always advance to the review that validates it.

### Per-Cycle Procedure

For each cycle **i = 1 … iterate**:

#### Step A — Assess

Retrieve the previous cycle's activity type and findings:
- Call `mcp__monomind__memory_retrieve` (namespace: `architect:<sessionId>`, key: `cycle_<i-1>_activity`) → `last_activity` (`"review"` or `"fix"`)
- Call `mcp__monomind__memory_retrieve` (namespace: `architect:<sessionId>`, key: `cycle_<i-1>_findings`) → `last_findings` (JSON findings list from the most recent review cycle)
- Parse `last_findings` to count CRITICAL and HIGH severity items
- **Apply early-stop only when ALL of: `i > 1` AND `last_activity == "review"` AND CRITICAL + HIGH count == 0.** Never early-stop at cycle 1 (always run at least one fix cycle) and never early-stop after a fix cycle — always advance to the review cycle that validates the fix.

#### Step B — Choose Activity

Retrieve `last_activity` from Step A and apply this table:

| `last_activity` | CRITICAL+HIGH count | `i` | This cycle activity |
|---|---|---|---|
| `review` (or initial pass) | > 0 | any | **fix** — implement all CRITICAL and HIGH recommendations |
| `review` (or initial pass) | 0 | > 1 | **stop** — early exit (architecture clean) |
| `review` (or initial pass) | 0 | == 1 | **review** — run a second independent review to confirm the clean result before stopping. Note: when `iterate == 1`, this confirmation review is the only available cycle slot; the loop terminates after it with one re-confirmation and no fix applied. This is intentional — if the goal is to skip iteration entirely on a clean initial pass, use `--iterate 0`. |
| `fix` | any | any | **review** — re-run architect to validate fixes |

State the decision:
> "Cycle \<i>/\<iterate>: \<fix|review> — \<one-sentence reason>. CRITICAL: \<n>, HIGH: \<n>."

#### Step C — Execute

**If activity = fix:**

Extract all CRITICAL and HIGH items from `last_findings`. Count them and store the count before spawning:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_fix_count", value: <count of CRITICAL+HIGH items>)
```

**Human-in-the-loop checkpoint (fix cycle):** Before spawning the build skill, write a file named `humaninloop-<YYYYMMDD-HHmmss>.md` (use current UTC datetime) in the `docs/` subdirectory of the project (create `docs/` if it does not exist). The file must contain:
```markdown
# Human Review — Cycle <i>/<iterate> Fix Pending

**Session:** <sessionId>
**Project:** <project_name>
**Cycle:** <i>/<iterate>
**Trigger:** fix cycle about to execute

## Findings to be Fixed

<one bullet per CRITICAL/HIGH item: `- [severity] [dimension]: [recommendation]`>

## Action

`mastermind:build` has been spawned to implement the above (execution continues immediately — this file is an async notification only, not a pause). To redirect or override, re-run the iteration after manually reverting any changes.

## Human Comments

<!-- Add your comments here -->
```

Store the filename so the blocked checkpoint can locate it if needed, and append it to the run's humaninloop file list:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_fixloop_file", value: "docs/humaninloop-<YYYYMMDD-HHmmss>.md")
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "humaninloop_files", value: <append "docs/humaninloop-<YYYYMMDD-HHmmss>.md" to existing list, or start new list if key absent>)
```
(Use the same `<YYYYMMDD-HHmmss>` value used when writing the file above.)

Spawn `Skill("mastermind:build")` with:
- `prompt`: "Implement the following architecture fixes:\n" followed by the CRITICAL and HIGH `recommendation` fields extracted from `last_findings`, one bullet per line (format: `- [severity] [dimension]: [recommendation]`)
- `project_name`: same project_name
- `board_id`: same board_id
- `brain_context`: same brain_context as the initial pass
- `stack`: same stack as the initial pass
- `sessionId`: same sessionId
- `mode`: auto
- `caller`: master

Wait for the build skill to return. Store the activity tag:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_activity", value: "fix")
```

Carry forward the review findings that triggered this fix (so Step A of the next cycle can read a real findings list):
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_findings", value: <same value as last_findings — the JSON from the prior review cycle>)
```

**If activity = review:**

Re-invoke `Skill("mastermind:architect")` with:
- `prompt`: if `i == 1` (clean initial pass — second independent review): "Second independent review to confirm initial clean result. Perform a fresh pass with no prior context bias." Otherwise: "Re-review after fixes applied in cycle \<i-1>. Focus on dimensions that had CRITICAL or HIGH findings: \<list dimension names from last_findings>"
- `project_name`, `board_id`, `brain_context`, `stack`: same as initial pass
- `scope`: if initial scope was `all`, use `review+deduplicate` (running both review and deduplicate catches structural regressions introduced by fixes without the full cost of design and migrate phases); otherwise use the same scope as the initial pass
- `mode`: auto
- `caller`: master
- `iterate`: 0 (prevents nested iteration)
- `sessionId`: same sessionId

Wait for the architect skill to return its output schema. Store the new findings and activity tag:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_findings", value: <output schema findings serialized as JSON>)
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "cycle_<i>_activity", value: "review")
```

#### Step D — Cycle Summary

**Human-in-the-loop checkpoint (blocked):** If the cycle returned `status: blocked`, write a file named `humaninloop-<YYYYMMDD-HHmmss>.md` (use current UTC datetime) in the `docs/` subdirectory of the project (create `docs/` if it does not exist) before outputting the summary. Note: if this is a fix cycle and a fix-cycle checkpoint file was already written this cycle (before spawning mastermind:build), do NOT create a second file — instead retrieve `cycle_<i>_fixloop_file` from memory (`mcp__monomind__memory_retrieve(namespace: "architect:<sessionId>", key: "cycle_<i>_fixloop_file")`) to get the exact filename, then append a `## Blocker` section to that file with the blocked status details:
```markdown
# Human Review — Cycle <i>/<iterate> Blocked

**Session:** <sessionId>
**Project:** <project_name>
**Cycle:** <i>/<iterate>
**Trigger:** cycle blocked — iteration halted; human intervention required to continue

## Blocker

<one-sentence description of what prevented the cycle from completing>

## Last Known Findings

<CRITICAL and HIGH items from last_findings, one bullet each>

## Human Comments

<!-- Describe how to unblock, then re-run with remaining cycles -->
```

Append the filename to the run's humaninloop file list:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "humaninloop_files", value: <append the just-written filename to existing list, or start new list if key absent>)
```

**After writing the file, stop the iteration loop immediately.** Do not proceed to cycle `i+1`. Set `actual_cycles_run = i`, output the compact summary line below marked `blocked`, then skip directly to ITERATION COMPLETE with `status: blocked`.

Output a compact line:
```
ITERATION <i>/<iterate> — <fix|review> — <complete|partial|blocked>
  → <one-line summary of what was done>
  → CRITICAL: <n>, HIGH: <n> [for review cycles: parse cycle_<i>_findings; for fix cycles: show counts from triggering review, labeled "(unvalidated — pending review cycle)"]
  → Next cycle: <predicted activity or "done — architecture clean">
```

---

### Iteration Complete Summary

**If the loop completed normally (all N cycles ran without early-stop or block): set `actual_cycles_run = iterate` before proceeding.** Otherwise, retain the value already set by the early-stop path (`actual_cycles_run = i - 1`) or the blocked path (`actual_cycles_run = i`) — do NOT overwrite it here. The post-loop guard may add a final validation review, but that review does not increment this count — it is reported separately as the `[Final validation: ...]` line in ITERATION COMPLETE.

**Post-loop guard:** After all N cycles complete (not after an early stop):
1. Retrieve `cycle_<iterate>_activity` from memory (namespace: `architect:<sessionId>`).
2. If its value is `"fix"`, run one additional final review cycle before reporting ITERATION COMPLETE. Use these parameters (do NOT use Step C's template — `i` is undefined at this point):
   - `prompt`: "Final validation review after all \<iterate> cycles complete. Focus on dimensions that had CRITICAL or HIGH findings: \<list dimension names from cycle_\<iterate>_findings> (findings from the pass that triggered this fix — may be the initial architect pass if `iterate == 1`)"
   - `project_name`, `board_id`, `brain_context`, `stack`: same as initial pass
   - `scope`: if initial scope was `all`, use `review+deduplicate`; otherwise same as initial pass
   - `mode`: auto, `caller`: master, `iterate`: 0, `sessionId`: same sessionId
   - Store results: `cycle_final_findings` and `cycle_final_activity = "review"` (namespace: `architect:<sessionId>`)
   - If the final review returns `status: blocked`: set `Status: blocked` in ITERATION COMPLETE, note "post-loop guard review blocked" in Final state, skip the unresolved-issues checkpoint, and go directly to ITERATION COMPLETE.
3. If its value is `"review"`, proceed directly to ITERATION COMPLETE.

This ensures the loop never terminates with unvalidated fixes regardless of whether N is odd or even.

**Human-in-the-loop checkpoint (unresolved issues):** This checkpoint only runs when the loop terminated normally (all N cycles ran) — skip it entirely on early-stop (count is 0 by definition on that path). After the post-loop guard completes, determine the final CRITICAL+HIGH count from the findings for the final review:
- Use `cycle_final_findings` if the post-loop guard fired (last cycle was a fix)
- Use `cycle_<iterate>_findings` if all N cycles ran and the last cycle was a review (guard did not fire)

If that count > 0, write a file named `humaninloop-<YYYYMMDD-HHmmss>.md` (use current UTC datetime) in the `docs/` subdirectory of the project (create `docs/` if it does not exist):
```markdown
# Human Review — Iteration Complete with Unresolved Issues

**Session:** <sessionId>
**Project:** <project_name>
**Cycles run:** <actual_cycles_run>/<iterate>
**Trigger:** all cycles exhausted; CRITICAL/HIGH issues remain

## Remaining Issues

<one bullet per CRITICAL/HIGH item from final review findings>

## Suggested Next Steps

<from the output schema `next_actions` field>

## Human Comments

<!-- Decide whether to re-run with --iterate <N>, fix manually, or accept the remaining findings -->
```

Append the filename to the run's humaninloop file list:
```
mcp__monomind__memory_store(namespace: "architect:<sessionId>", key: "humaninloop_files", value: <append the just-written filename to existing list, or start new list if key absent>)
```

After writing the file, continue immediately to ITERATION COMPLETE output — do not halt execution.

After all cycles finish (or early stop), output:

**List one line per cycle from `i = 1` through `actual_cycles_run` only.** If early-stop fired at cycle `k`, do not emit lines for cycles `k` through `iterate` — those cycles did not execute and have no stored keys. For each fix cycle, retrieve `cycle_<i>_fix_count` from memory. For each review cycle, read `cycle_<i>_findings` for the CRITICAL and HIGH counts.

**Determine `Status` before rendering ITERATION COMPLETE:**
- `blocked` — if the loop was halted by a blocked cycle OR the post-loop guard review returned `status: blocked`
- `partial` — if the unresolved-issues checkpoint fired (final CRITICAL+HIGH count > 0) and all N cycles ran
- `complete` — if no CRITICAL or HIGH findings remain in the final review (unresolved-issues checkpoint did not fire)

```
ITERATION COMPLETE — <actual_cycles_run>/<iterate> — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: complete | partial | blocked
Cycle 1: fix     → <cycle_1_fix_count> fixes requested
Cycle 2: review  → CRITICAL: <n>, HIGH: <n> remaining
Cycle 3: fix     → <cycle_3_fix_count> fixes requested
...
[Final validation: review  → CRITICAL: <n>, HIGH: <n>]  ← include only if post-loop guard fired; read from cycle_final_findings
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Final state: <one-sentence assessment>
Suggested next: <what to do next, e.g. "run mastermind:release" or "all architecture findings resolved">
Human-in-the-loop files: <retrieve humaninloop_files from memory (namespace: "architect:<sessionId>"); list each filename, or "none" if key absent>
```

Then, if `caller` is `standalone`, follow _protocol.md Brain Write Procedure (namespace: `architect`) — the iteration results count as additional decisions scored from this run. If `caller` is `command` or `master`, skip — the caller handles the brain write.

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full architecture audit | Software Architect + specialists | hierarchical 6 raft specialized |
| File structure dedup only | Software Architect | hierarchical 3 raft specialized |
| Coupling + dependency analysis | Software Architect | mesh 3 gossip balanced |
| API + data layer design | Backend Architect + Database Optimizer | hierarchical 4 raft specialized |
| Security architecture | Security Engineer + Software Architect | hierarchical-mesh 4 byzantine specialized |
| Single design question | Software Architect | single agent |

---

## ADR Template

When the Architecture Manager produces Architecture Decision Records, use this format.

**ADR numbering:** Before writing a new ADR, scan for existing ADR files in common locations (`docs/adr/`, `architecture/decisions/`, `adr/`, `docs/architecture/`). Find the highest existing `ADR-NNN` number and increment by 1. If no ADR files are found, start at `ADR-001`. Write each ADR to the first discovered location (or `docs/adr/` as default).

```markdown
# ADR-NNN: [Title]   <!-- replace NNN with the next sequential number -->

**Date:** YYYY-MM-DD   <!-- substitute with the resolved UTC date from the CONTEXT header -->
**Status:** Proposed | Accepted | Deprecated | Superseded

## Context
[What problem or decision was this addressing?]

## Decision
[What was decided?]

## Consequences
**Positive:**
- [benefit 1]

**Negative / Trade-offs:**
- [cost or constraint 1]

**Neutral:**
- [side effect worth noting]
```
