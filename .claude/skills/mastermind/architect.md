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
- `scope`: optional — `review` | `design` | `deduplicate` | `migrate` | `all` (default: inferred from prompt)
- `stack`: optional — detected tech stack hint (e.g. `typescript`, `python`, `react`, `rails`, `go`)

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

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `architect`)
2. Run intake from _intake.md if prompt is vague
3. Detect stack from current directory:
   ```bash
   # Detect tech stack
   ls package.json pyproject.toml go.mod Cargo.toml pom.xml build.gradle mix.exs Gemfile 2>/dev/null
   # Count file types
   find . \( -name "*.ts" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) | head -5
   ```
4. Create or find monotask space `<project_name>`, create board `architect`
5. Proceed with complexity assessment below
6. At end: follow _protocol.md Brain Write Procedure (namespace: `architect`)

---

## Stack Detection & Specialist Routing

After detecting the stack, route to the appropriate specialist lens:

| Stack | Primary Architect Agent | Secondary Agents |
|---|---|---|
| TypeScript / Node.js | Software Architect | Backend Architect, Database Optimizer |
| Python / FastAPI / Django | Software Architect | Backend Architect, Data Engineer |
| React / Next.js / Vue | Software Architect | Frontend Developer, UX Researcher |
| Go | Software Architect | Backend Architect, SRE |
| Ruby on Rails | Software Architect | Backend Architect, Database Optimizer |
| Java / Spring | Software Architect | Backend Architect |
| Rust | Software Architect | Backend Architect |
| Mobile (React Native / Swift / Kotlin) | Mobile App Builder | Software Architect |
| Game (Unity / Unreal / Godot) | Unity Architect / Unreal Systems Engineer | Game Designer |
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
# 1. Find duplicate file names across the tree
find . \( -name "*.ts" -o -name "*.py" -o -name "*.js" \) \
  | grep -v node_modules | grep -v ".git" \
  | xargs -I{} basename {} \
  | sort | uniq -d | head -30

# 2. Find files with identical content (exact duplicates)
find . -type f \( -name "*.ts" -o -name "*.py" -o -name "*.js" \) \
  | grep -v node_modules | grep -v dist | grep -v ".git" \
  | xargs md5sum 2>/dev/null | sort | awk 'seen[$1]++ {print}' | head -20

# 3. Find very small files that may be consolidation candidates
find . -type f \( -name "*.ts" -o -name "*.py" \) \
  | grep -v node_modules | grep -v dist | grep -v test | grep -v spec \
  | xargs wc -l 2>/dev/null | sort -n | awk '$1 < 20 {print}' | head -20

# 4. Find oversized files that need splitting
find . -type f \( -name "*.ts" -o -name "*.py" \) \
  | grep -v node_modules | grep -v dist \
  | xargs wc -l 2>/dev/null | sort -rn | head -20

# 5. Detect circular dependencies (TypeScript/JS)
npx madge --circular --ts-config tsconfig.json src/ 2>/dev/null || \
npx madge --circular src/ 2>/dev/null | head -20

# 6. Find god files (imported by many others)
# JS/TS: count how many files import each module name
grep -rh "from ['\"]" . --include="*.ts" --include="*.js" \
  2>/dev/null | grep -v node_modules | grep -v dist \
  | perl -ne 'print "$1\n" if /from\s+['"'"'"]\([^'"'"'")\t ]+\)/' \
  | sort | uniq -c | sort -rn | head -20
# Python: count imports separately (no quotes in Python import syntax)
grep -rh "^from \|^import " . --include="*.py" 2>/dev/null \
  | grep -v node_modules | grep -v dist \
  | awk '{print $2}' | sed 's/\..*//' | sort | uniq -c | sort -rn | head -20
# Note: if monograph is built, prefer mcp__monomind__monograph_god_nodes — it uses the pre-computed graph index
```

For each finding, produce a **Deduplication Action Table**:

| File | Issue | Action | Risk |
|---|---|---|---|
| `src/utils/helpers.ts` | Duplicate of `src/lib/helpers.ts` | Merge into `src/lib/helpers.ts`, update 3 imports | Low |
| `src/controllers/user.ts` | 847 lines, 3 concerns | Split into UserController + UserQueryController + UserMutationController | Medium |

---

## Complex Execution — Architecture Manager Agent

Spawn an Architecture Manager agent via Task tool:

```javascript
Task({
  subagent_type: "Software Architect",
  description: `You are the Architecture Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Stack: <stack> | Spawned by: mastermind:architect

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>
SCOPE: <scope>

STEP 1 — ORIENT
Detect the tech stack and project structure:

\`\`\`bash
ls package.json pyproject.toml go.mod Cargo.toml pom.xml build.gradle mix.exs Gemfile 2>/dev/null
find . -maxdepth 3 -type d | grep -v node_modules | grep -v ".git" | grep -v dist | head -40
find . \( -name "*.ts" -o -name "*.py" -o -name "*.go" \) | grep -v node_modules | wc -l
\`\`\`

Then detect duplicate file names and god files using the deduplication procedure (see mastermind:architect skill).

STEP 2 — PLAN
Decompose the architecture goal into parallel specialist streams based on scope:

- **review**: structure, coupling, patterns, DDD, API design, data, observability, security
- **deduplicate**: exact duplicates, oversized files, undersized files, circular deps, god files
- **design**: bounded contexts, layer boundaries, interface contracts, data model
- **migrate**: current-state mapping, target-state design, migration sequence, risk assessment
- **all**: run all four streams — review first (establishes baseline), then deduplicate, then design for any unaddressed gaps, then migrate if a migration target is identified from the design phase

For each stream, identify:
- Which dimension of the checklist it covers
- Which specialist agent is most suited (see Stack Detection table)
- What concrete artifacts it must produce (diagram, action table, ADR, etc.)
- Dependencies between streams (e.g. coupling analysis before deduplication plan)

STEP 3 — CREATE TASKS
For each architecture stream, call /monomind:createtask with this briefing format:

  CONTEXT: <date> | Project: <project_name> | Stack: <stack> | Created by: Architecture Manager
  BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
  GOAL: [specific architecture dimension to assess or design]
  SCOPE: [exact files, modules, or surfaces in scope]
  CHECKLIST: [specific items from the architecture review checklist to evaluate]
  CONSTRAINTS: [existing decisions not to revisit, performance budgets, team skill constraints]
  SUCCESS CRITERIA:
  - [ ] [e.g. "all circular deps mapped with import paths"]
  - [ ] [e.g. "deduplication action table with risk ratings"]
  - [ ] [e.g. "ADR written for each major design decision"]
  AGENT: [Software Architect | Backend Architect | Database Optimizer | Frontend Developer | SRE]
  SWARM: [consult Domain Swarm Defaults table — e.g. mesh 3 gossip for coupling analysis, hive-mind byzantine for security]
  REPORTS TO: <board_id>
  DEPENDENCIES: [task IDs or "none"]
  OUTPUT FORMAT: unified output schema

STEP 4 — EXECUTE
Spawn one Task agent per architecture stream in parallel. The list below is the default; override subagent_type for specialized stacks using the Stack Detection table (e.g. Mobile App Builder for React Native/Swift/Kotlin, Unity Architect for game projects):

- Structure + dedup: subagent_type "Software Architect"
- Coupling + god files: subagent_type "Software Architect"
- Data layer: subagent_type "Database Optimizer"
- API surface: subagent_type "Backend Architect"
- Security posture: subagent_type "Security Engineer"
- Frontend architecture (if applicable): subagent_type "Frontend Developer"
- Observability: subagent_type "SRE (Site Reliability Engineer)"

BEFORE spawning each agent, emit agent:spawn to the live dashboard:
WebFetch({ url: "http://localhost:4242/api/mastermind/event", method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ type:"agent:spawn", session:"<sessionId>",
    domain:"architect", agent:"<agent-slug>", task:"<stream-description>", ts:Date.now() }) })

Also run /monomind:do --board <board_id> to track execution.

BEFORE returning, emit domain:complete to the live dashboard:
WebFetch({ url: "http://localhost:4242/api/mastermind/event", method: "POST",
  headers: {"Content-Type":"application/json"},
  body: JSON.stringify({ type:"domain:complete", session:"<sessionId>",
    domain:"architect", status:"complete|partial|blocked",
    artifacts:["/path/to/report"], decisions:[{what:"...",confidence:0.9}], ts:Date.now() }) })

STEP 5 — SYNTHESIZE
Collect all findings. Produce:
1. **Architecture Health Score** (0–100) by dimension
2. **Deduplication Action Table** (if scope includes deduplicate)
3. **Critical Issues List** (must-fix before next release)
4. **Recommended ADRs** (Architecture Decision Records for open decisions)
5. **Refactoring Roadmap** (prioritized by impact/effort matrix)

Return to caller:

domain: architect
status: complete | partial | blocked
artifacts:
  - path: [architecture report if written to disk]
    type: report
  - path: [ADR files if written]
    type: adr
decisions:
  - what: [key architectural decisions and recommendations]
    why: [evidence and tradeoffs]
    confidence: [0.0-1.0]
    outcome: pending
lessons:
  - what_worked: [which analysis streams surfaced the most value]
  - what_didnt: [gaps in coverage]
next_actions:
  - [e.g. "run mastermind:build to implement refactoring plan"]
  - [e.g. "run mastermind:review after restructuring is complete"]
  - [e.g. "address critical issues before next release"]
board_url: monotask://<project_name>/architect
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single specialist, single question):

1. Spawn one Task agent (`subagent_type: "Software Architect"`) with the architecture question as a self-contained briefing
2. Include current directory structure context (`find . -maxdepth 3 -type d | grep -v node_modules`)
3. Collect output and return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full architecture audit | Software Architect + specialists | hierarchical 6 raft specialized |
| File structure dedup only | Software Architect | hierarchical 3 raft specialized |
| Coupling + dependency analysis | Software Architect | mesh 3 gossip balanced |
| API + data layer design | Backend Architect + Database Optimizer | hierarchical 4 raft specialized |
| Security architecture | Security Engineer + Software Architect | hive-mind hierarchical-mesh byzantine 4 |
| Single design question | Software Architect | single agent |

---

## ADR Template

When the Architecture Manager produces Architecture Decision Records, use this format:

```markdown
# ADR-NNN: [Title]

**Date:** YYYY-MM-DD
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
