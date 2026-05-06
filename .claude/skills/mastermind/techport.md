---
name: mastermind:techport
description: Tech Port — deep-analyzes a foreign project, reviews the current monomind target to avoid conflicts and duplication, produces a scored port plan with mono-branded naming, and executes approved ports with full brand normalization.
type: domain-skill
default_mode: confirm
---

# Mastermind TechPort

Five-phase porting skill. Phases 0–1 run in parallel. Phase 2 builds the gap matrix. Phase 3 produces the port plan and is the confirm gate (STOP — wait for user approval). Phase 4 is pre-execution setup (snapshot + secrets check). Phase 5 executes with full mono branding normalization.

---

## Standalone Execution

If invoked directly (not by `mastermind:master`):
1. Load brain context following `_protocol.md` Brain Load Procedure (namespace: `techport`)
2. Parse `source_path`, `focus_hint`, `mode` from user input
3. Proceed with Phase 0 below
4. At the end of every run — regardless of which phase concluded — execute `_protocol.md` Brain Write Procedure, writing output to namespace `mastermind:techport:raw`. This includes Phase 1A license-gate STOPs and secrets STOPs. Never skip Brain Write.

---

## Inputs

- `source_path`: absolute or relative path to the foreign project root
- `focus_hint`: optional — what to look for ("CLI commands", "animation", "hooks", "skills"); default: `"core architecture skills commands hooks agents"`
- `mode`: confirm | auto
- `partial`: boolean — if true, skip strategy (a) Copy-As-Is; force (b) Adapt or (c) Extract only
- `source_brand`: derived in Phase 1A — PascalCase brand name of the source project (e.g. `RuvSwarm`, `ClaudeFlow`); used in all `rg -i "{source_brand}"` brand contamination checks
- `candidate_file`: derived during Phase 1E–1F — absolute path to a specific source file under analysis; substituted before running per-candidate coupling checks

---

## Phase 0 — Target (Monomind) Deep Review

**Run before looking at the source project.** This establishes what already exists, what naming conventions are enforced, and what architectural constraints must not be violated.

Steps 0B–0D run in parallel with Phase 1. Phase 0A runs first in sequence.

### 0A — Existing Capability Inventory

**Step 1 — check index freshness, rebuild only if stale (must complete before Step 2):**
```
Call mcp__monomind__monograph_health({})
IF health.commitsBehind > 0 OR health.status != "fresh":
  Call mcp__monomind__monograph_build({ codeOnly: true })
  // monograph_build runs in the background. Poll freshness by re-calling monograph_health
  // every ~10s until health.status == "fresh" or health.commitsBehind == 0, then proceed to Step 2.
// If index is already fresh, skip monograph_build and proceed directly to Step 2
```

**Step 2 — query the fresh index (run after Step 1 completes):**
```
Call mcp__monomind__monograph_god_nodes({})         // load-bearing files — porting near them is dangerous
Call mcp__monomind__monograph_community({})          // module cluster structure — boundary map
Call mcp__monomind__monograph_bridge({})             // cross-community connectors — architectural seams
Call mcp__monomind__monograph_stats({})              // fan-in/out percentile distribution
Call mcp__monomind__monograph_query({ query: focus_hint OR "core architecture skills commands hooks agents" })
```

Also search for existing equivalents of anything the focus_hint mentions:
```bash
# Find existing skills, commands, agents that might overlap
# LLM substitutes {focus_hint} before running; if focus_hint is empty, use the fallback terms below
HINT_TERMS="{focus_hint}"
# If HINT_TERMS is empty or unset (no focus_hint provided), default to: core architecture skills commands hooks agents
[ -z "$HINT_TERMS" ] && HINT_TERMS="core architecture skills commands hooks agents"
HINT_PATTERN=$(echo "$HINT_TERMS" | tr ' ' '|')
find /Users/morteza/Desktop/tools/monobrain/.claude -name "*.md" \
  | xargs grep -liE "$HINT_PATTERN" 2>/dev/null | head -20
```

**Deliverable:** a list of existing capabilities that any ported item must be checked against.

### 0B — Naming Convention Extraction (from actual monomind code)

Extract the real conventions — not the stated ones — from the codebase itself:

```bash
BASE=/Users/morteza/Desktop/tools/monobrain/packages/@monomind/cli/src

# File name convention
find "$BASE" -name "*.ts" | grep -v dist | sed 's|.*/||' | \
  python3 -c "import sys,re; names=[l.strip() for l in sys.stdin]; \
  camel=sum(1 for n in names if re.match(r'[a-z][a-zA-Z]+\.ts',n)); \
  kebab=sum(1 for n in names if '-' in n); snake=sum(1 for n in names if '_' in n); \
  print(f'kebab={kebab} camelCase={camel} snake={snake}')"

# Class/interface name convention
grep -rhn "^export class\|^export interface\|^export abstract class" "$BASE" \
  | grep -oE "(class|interface) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | sort | uniq | head -60

# Suffix patterns (what suffixes dominate)
grep -rhn "^export" "$BASE" --include="*.ts" \
  | grep -oE "(class|interface|function|const|type|enum) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | \
  python3 -c "import sys,re; words=[l.strip() for l in sys.stdin]; \
  from collections import Counter; \
  suffixes=[re.findall('[A-Z][a-z]+$',w)[0] for w in words if re.findall('[A-Z][a-z]+$',w)]; \
  [print(n,s) for s,n in Counter(suffixes).most_common(15)]"

# Domain vocabulary (nouns appearing in 3+ exported names)
grep -rhn "^export" "$BASE" --include="*.ts" \
  | grep -oE "(class|interface|function|const|type|enum) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | \
  python3 -c "import sys,re; from collections import Counter; \
  words=[]; \
  [words.extend(re.findall('[A-Z][a-z]+', l.strip())) for l in sys.stdin]; \
  [print(n,w) for w,n in Counter(words).most_common(20) if n >= 2]"

# Error hierarchy
grep -rn "extends.*Error\|class.*Error" "$BASE" --include="*.ts" | grep "^export\|export " | head -15

# Async model
echo "async/await count:" && grep -rn "async function\|async (" "$BASE" --include="*.ts" | wc -l
echo "Promise.then count:" && grep -rn "\.then(" "$BASE" --include="*.ts" | grep -v "//" | wc -l

# Dependency injection style
grep -rn "constructor(" "$BASE" --include="*.ts" | grep "private\|readonly\|protected" | head -10
```

**Deliverable: Monomind Naming Standard (MNS)** — output a concrete standard block:

```
MONOMIND NAMING STANDARD (extracted from codebase)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
File names:         kebab-case (e.g., agent-pool.ts, hook-handler.ts)
Class names:        PascalCase with domain prefix (Agent*, Swarm*, Graph*, Hook*)
Interface names:    PascalCase, no 'I' prefix (Config, Options, Result)
Skill names:        mono<domain> prefix (monomotion, monograph, monodesign)
Function names:     camelCase, no prefix
Config keys:        camelCase
Env vars:           MONOMIND_* (uppercase snake)
npm packages:       @monomind/<name>
CLI commands:       monomind <command>
Error classes:      Extend CLIError or domain error (e.g., GraphError extends CLIError)
Event names:        domain:action kebab (e.g., 'agent:spawned', 'hook:fired')
Log prefixes:       [MODULE_NAME] or [monomind]
Barrel files:       index.ts per directory (all public exports must go through it)
Async model:        async/await (no .then() chains, no callbacks)
DI style:           Constructor injection, no DI container, no decorators
Domain vocab:       Agent, Memory, Swarm, Config, Node, Graph, Session, Task, Worker, Hook, Plugin
```

### 0C — Dependency Direction Constraints

```bash
BASE=/Users/morteza/Desktop/tools/monobrain/packages/@monomind/cli/src

# Map import directions by directory layer
for dir in types utils core commands services; do
  count=$(grep -rn "^import" "$BASE/$dir" --include="*.ts" 2>/dev/null | wc -l)
  refs=$(grep -rn "from.*/$dir/" "$BASE" --include="*.ts" 2>/dev/null | wc -l)
  echo "$dir: imports=$count | imported_by=$refs"
done
```

Extract the implied layering from the import ratio. High `imported_by` → leaf/utility layer (can be imported anywhere). Low `imported_by` → entry/command layer (should not be imported by core).

**Deliverable: Dependency Direction Map** — ported code must not violate this map.

### 0D — Build Monomind Vocabulary Name Set (for collision detection)

```bash
grep -rhn "^export" /Users/morteza/Desktop/tools/monobrain/packages/@monomind/cli/src \
  --include="*.ts" | grep -v dist | \
  grep -oE "(class|interface|function|const|type|enum) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | sort -u \
  > /tmp/monomind_names.txt
echo "Monomind exported names: $(wc -l < /tmp/monomind_names.txt)"
```

---

## Phase 1 — Source Project Reconnaissance

Run in parallel with Phase 0.

### 1A — Identity, Tech Stack, and License (Gate)

```bash
cat "{source_path}/package.json" 2>/dev/null | head -40
cat "{source_path}/pyproject.toml" 2>/dev/null | head -20
head -5 "{source_path}/LICENSE" 2>/dev/null
head -80 "{source_path}/README.md" 2>/dev/null
```

**LICENSE GATE — evaluate before proceeding:**
- MIT / Apache-2.0 / BSD-2/3 / ISC / Unlicense → **proceed** (all strategies available)
- MPL-2.0 / LGPL → **proceed with restriction** (no Full Copy-As-Is; Adapt or Extract only; adapter boundary required)
- GPL-2.0 / GPL-3.0 / AGPL → **STOP** — Inspiration-Only; no code ported; tell user why; then execute Brain Write (status: blocked) before exiting
- Proprietary / No License → **STOP** — cannot port; tell user to get permission first; then execute Brain Write (status: blocked) before exiting

**BRAND EXTRACTION — required before Phase 2B collision detection:**

Extract `source_brand` from three signals, pick the most specific:
1. `package.json` `name` field: strip `@scope/` prefix, convert to PascalCase (e.g., `claude-flow` → `ClaudeFlow`, `ruv-swarm` → `RuvSwarm`)
2. README H1 title: extract the project name word(s) before any tagline
3. Class name prefixes: run `grep -rhn "^export class\|^export abstract class" "{source_path}/src" --include="*.ts" 2>/dev/null | grep -oE "(class) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | grep -oE "^[A-Z][a-z]+" | sort | uniq -c | sort -rn | head -5` — the most frequent leading word (e.g., `Ruv` from `RuvSwarm`, `Claude` from `ClaudeFlow`) is the brand prefix; convert to PascalCase compound if needed

Set `source_brand` to the PascalCase result (e.g., `RuvSwarm`, `ClaudeFlow`, `SourceProject`). This variable is used verbatim in all subsequent `rg -i "{source_brand}"` calls and the collision-detection Python script.

### 1B — Repo-Map (Structural Index)

```bash
# File tree
find "{source_path}" -maxdepth 4 \
  \( -name node_modules -o -name .git -o -name dist -o -name build \
     -o -name __pycache__ -o -name .cache -o -name coverage \) -prune \
  -o -type f -print | grep -E '\.(ts|tsx|js|mjs|cjs|py|go|rs|java|cs)$' | head -300

# Exported symbols
grep -rhn "^export" "{source_path}/src" --include="*.ts" 2>/dev/null | \
  grep -oE "(class|interface|function|const|type|enum) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | sort -u | head -150

# Import relationships
grep -rn "^import.*from" "{source_path}/src" --include="*.ts" 2>/dev/null | \
  grep -v node_modules | head -80
```

### 1C — Dependency Graph and Circular Dependencies

```bash
command -v madge && madge "{source_path}/src" --circular --extensions ts,js --json 2>/dev/null
command -v lizard && lizard "{source_path}/src" --json 2>/dev/null | \
  python3 -c "import sys,json; d=json.load(sys.stdin); fns=d.get('function_list',[]); \
  print(f'Functions: {len(fns)}, CC>10: {len([f for f in fns if f[\"cyclomatic_complexity\"]>10])}, CC>30: {len([f for f in fns if f[\"cyclomatic_complexity\"]>30])}')" 2>/dev/null
if command -v jscpd &>/dev/null; then
  jscpd "{source_path}/src" --reporters json --output /tmp/jscpd-report 2>/dev/null
  python3 -c "
import json, os
report = '/tmp/jscpd-report/jscpd-report.json'
if os.path.exists(report):
    d = json.load(open(report))
    s = d.get('statistics', {})
    print(f'Clone%: {s.get(\"percentage\", 0):.1f}%')
else:
    print('Clone%: (jscpd report not found)')
" 2>/dev/null
fi
```

### 1D — Risk Signal Detection

```bash
src="{source_path}/src"
echo "Global state:" && grep -rn "^let \|^var " "$src" --include="*.ts" | grep -v "const\|test\|spec\|//" | wc -l
echo "Import side effects:" && grep -rn "^fetch(\|^axios\.\|^fs\.\|^process\.exit\|mongoose\.connect" "$src" --include="*.ts" | grep -v "test\|spec\|//" | head -5
echo "Prototype mutations:" && grep -rn "\.prototype\." "$src" --include="*.ts" | grep -v "test\|spec\|\.d\.ts" | wc -l
echo "Framework coupling:" && grep -rn "@Injectable\|@Module\|@Entity\|app\.use\|useEffect\|componentDidMount" "$src" --include="*.ts" | wc -l
echo "Env dependencies:" && grep -rn "process\.env\." "$src" --include="*.ts" | sed 's/.*process\.env\.\([A-Z_]*\).*/\1/' | sort -u
echo "Secrets scan:"
if command -v gitleaks &>/dev/null; then
  gitleaks detect -s "{source_path}" --report-path /tmp/gl.json -q 2>/dev/null
  gitleaks_exit=$?
  python3 -c "
import json, os
if os.path.exists('/tmp/gl.json'):
    d = json.load(open('/tmp/gl.json'))
    print(f'Secrets found: {len(d)}')
    if d:
        files = sorted({e.get('File','?') for e in d})
        print('Affected files (exclude from port plan):')
        for f in files: print(f'  {f}')
else:
    print('Secrets found: unknown (report missing)')
" 2>/dev/null
  if [ $gitleaks_exit -eq 1 ]; then
    echo "WARNING: files listed above must appear in SKIPPED section of Phase 3 plan — do not include in any port candidate"
  elif [ $gitleaks_exit -ge 2 ]; then
    echo "WARNING: gitleaks scan failed (exit $gitleaks_exit) — secrets scan incomplete, proceed with caution"
  fi
else
  echo "(gitleaks not installed — skip secrets scan)"
fi
```

**Risk Score = (circularDeps × 3) + (globalState × 2) + (importSideEffects × 4) + (frameworkCoupling ÷ 10) + (prototypeMutations × 3)**
- < 5: Low | 5–15: Medium | 15–30: High | > 30: Critical (do not port directly)

### 1E — Feature Surface Discovery

```bash
find "{source_path}" -name "SKILL.md" | grep -v node_modules
find "{source_path}" -path "*/.claude/commands*" -name "*.md" | grep -v node_modules
find "{source_path}/src" -type d -name "commands" -o -type d -name "cmd" 2>/dev/null | head -10
find "{source_path}/src" -name "*.tsx" -o -name "*.vue" 2>/dev/null | grep -v node_modules | grep -v test | head -30
```

### 1F — Dependency Graph Analysis of Source Project

`monograph_build` only indexes the current monomind workspace and cannot analyze an external project. Use filesystem tooling instead:

```bash
src="{source_path}"

# Fan-out per file (how many imports each file has)
find "$src" -name "*.ts" ! -path "*/node_modules/*" ! -path "*/dist/*" | while read f; do
  count=$(grep -c "^import" "$f" 2>/dev/null); count=${count:-0}
  echo "$count $f"
done | sort -rn | head -20

# Fan-in per file (how many other files import it — proxy for criticality)
find "$src" -name "*.ts" ! -path "*/node_modules/*" ! -path "*/dist/*" | while read f; do
  base=$(basename "$f" .ts)
  count=$(rg -l "from ['\"].*/${base}['\"]" "$src" --glob "*.ts" 2>/dev/null | grep -v "$f" | wc -l); count=${count:-0}
  echo "$count $f"
done | sort -rn | head -20
```

For each feature candidate from 1E, measure coupling manually:

```bash
candidate="{candidate_file}"
echo "=== Fan-out (imports):"
grep "^import" "$candidate" | wc -l
echo "=== Fan-in (imported by):"
grep -rl "from.*$(basename "$candidate" .ts)" "{source_path}/src" --include="*.ts" 2>/dev/null | grep -v "$candidate" | wc -l
echo "=== Circular dep check (if madge available):"
command -v madge && madge "$candidate" --circular --extensions ts,js 2>/dev/null || echo "(madge not installed — skip)"
```

**High fan-in (>5) + circular deps = high coupling risk → prefer strategy (c) or (d).**

### 1G — Maintenance Activity

```bash
git -C "{source_path}" log --oneline --since="90 days ago" | wc -l
git -C "{source_path}" log --format='%ae' | sort | uniq -c | sort -rn | head -5
```

---

## Phase 2 — Gap Matrix and Collision Analysis

Combine Phase 0 and Phase 1 findings.

### 2A — Capability Gap Matrix

```
| Capability    | Source Has | Monomind Has | Delta        | Monograph Match |
|---------------|-----------|--------------|--------------|-----------------|
| <feature>     | ✓         | ✗            | NEW          | none            |
| <feature>     | ✓ better  | ✓ basic      | UPGRADE      | <file>:<line>   |
| <feature>     | ✓         | ✓ equivalent | SKIP         | <file>:<line>   |
```

For every "NEW" or "UPGRADE" row, call:
```
mcp__monomind__monograph_query({ query: "<feature domain terms>" })
```
If it returns results → mark as UPGRADE candidate (something similar exists). If empty → mark as NEW.

### 2B — Collision Detection

Build the source's post-rename name set and diff against monomind's names:

```bash
# What source names WOULD become after mono-branding (rough pass)
grep -rhn "^export" "{source_path}/src" --include="*.ts" 2>/dev/null | \
  grep -oE "(class|interface|function|const|type|enum) [A-Z][A-Za-z0-9]+" | awk '{print $2}' | \
  python3 -c "
import sys, re
source_brand = '{source_brand}'  # LLM substitutes the PascalCase value from Phase 1A before running (e.g. 'RuvSwarm', 'ClaudeFlow')
# Mono prefix: the domain prefix used in monomind for this context (e.g. 'Mono', 'Agent', 'Graph')
# LLM: substitute the actual mono prefix from Phase 0B's MNS before running
mono_prefix = '{mono_prefix}'
for line in sys.stdin:
    name = line.strip()
    # Strip source brand, then prepend mono prefix to form the intended monomind name
    stripped = re.sub(source_brand, '', name, flags=re.IGNORECASE)
    branded = mono_prefix + stripped if stripped else mono_prefix + name
    print(branded)
" | sort -u > /tmp/source_renamed.txt

# Compare INTENDED monomind names against what already exists — real collision detection
comm -12 /tmp/monomind_names.txt /tmp/source_renamed.txt > /tmp/collisions.txt
echo "Collisions found: $(wc -l < /tmp/collisions.txt)"
cat /tmp/collisions.txt
```

**Collision resolution table:**

| Collision type | Resolution |
|---|---|
| Same name, same purpose | Do NOT port — use monomind's existing type |
| Same name, different purpose | Disambiguate: add domain suffix (e.g., `DatabaseSession` vs `AgentSession`) |
| Same name, superset/subset | Merge or extend the existing monomind interface |
| Same name, different module only | Namespace import: `import type { X as PortedX }` |

All collisions must be resolved before Phase 5 begins.

### 2C — Port Value Score (PVS) for Each Candidate

```
PVS = (FunctionalUniqueness × 2)   // 0–5: absent from monomind = 5
    + TestCoverage                  // 0–5: ≥70% = 5, 40-69% = 3, <40% = 0
    + ModularityScore               // 0–5: fan-out ≤ 2 = 5, >10 = 0
    + DocumentationQuality          // 0–5: JSDoc + README + examples + zero FIXMEs + typed
    + LicenseScore                  // 5/3/0: see 1A gate
    + MaintenanceActivity           // 0–5: >10 commits/90d = 5
    - DebtPenalty                   // 0–5: high CC + low coverage
    - BusFactor_Penalty             // 0–2: bus_factor=1 = -2
```

**Port if PVS ≥ 24. Inspect if 12–23. Skip if < 12.**

### 2D — Strategy Selection (Decision Tree per Candidate)

```
1. License copyleft / proprietary?                → (d) Inspiration-Only
2. Secrets found in source files for this module? → SKIP entirely
3. Fan-out > 15 OR circular deps involving it?    → (c) Extract-Pattern or (d) Inspiration
4. Paradigm distance ≥ 3?                         → (c) Extract-Pattern
5. Framework coupling > 40%?                      → (b) Adapt-And-Port or (c) Extract-Pattern
6. `partial == false` AND CC < 15 AND fan-out ≤ 2 AND coverage ≥ 70%
   AND LOC < 300 AND no global state?             → (a) Copy-As-Is → then brand-normalize
   (if `partial == true`: skip to step 7)
7. Default                                        → (b) Adapt-And-Port
```

---

## Phase 3 — Port Plan Report

```
╔══════════════════════════════════════════════════════════════════╗
║  TECHPORT ANALYSIS: <source_path>                                ║
╚══════════════════════════════════════════════════════════════════╝

SOURCE PROJECT
  Name:     <name>  →  Will be referenced as: <mono-branded alias>
  Stack:    <languages, frameworks>
  Size:     <file count, LOC>
  License:  <license> (<port permission level>)
  Activity: <commits/90d>, bus factor <N>
  Summary:  <2–3 sentences on what it does and its unique value>

RISK PROFILE
  Global state: <N> | Import side effects: <N> | Circular deps: <N>
  Framework coupling: <N%> | Risk Score: <N> → Low/Medium/High/Critical

MONOMIND CONSTRAINTS ACTIVE
  Naming standard: kebab files, PascalCase domain-prefixed types, mono<domain> skills
  Dependency direction: <extracted layer map>
  Existing equivalents: <list of existing features that may overlap>
  Name collisions found: <N> (resolved: <N>)

━━━ HIGH-VALUE PORT CANDIDATES (PVS ≥ 24) ━━━━━━━━━━━━━━━━━━━━━━━

🟢 [PVS: N | Risk: N] <Original Name> → <Mono-branded Name>
   Strategy:     (a) Copy-As-Is | (b) Adapt | (c) Extract-Pattern | (d) Inspiration
   Source files: <source files involved>
   Lands in:     <target path in monomind>
   Branded name: <what the type/skill/command/file will be called in monomind>
   Value:        <what capability gap it fills>
   Conflicts:    <naming or architectural conflicts, and how resolved>
   Risk:         <specific signals found>
   Effort:       trivial / hours / days

[repeat, ordered by PVS descending]

━━━ MEDIUM-VALUE CANDIDATES (PVS 12–23) — include by number ━━━━━

🟡 [N+1 | PVS: N | Risk: N] <Original Name> → <Mono-branded Name>
   <one-line value + one-line concern>
(numbers continue from HIGH-VALUE list; user can include by saying "3" or "1 3 4")

━━━ SKIPPED (PVS < 12 / License / Secrets) ━━━━━━━━━━━━━━━━━━━━━━

🔴 <Name> — <reason>

━━━ COMPATIBILITY NOTES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Module system:  <CJS/ESM match or conflict>
TypeScript:     <strict mode match or conflict>
Async model:    <match or must adapt>
Error model:    <source error type → how it maps to monomind CLIError hierarchy>
Naming delta:   <convention distance 0–3, what must change>
Dependencies:   <shared deps at conflicting major versions>

━━━ RECOMMENDED PORT ORDER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. <Name> → <Mono name> — <why first>
2. <Name> → <Mono name>
...

══════════════════════════════════════════════════════════════════
Proceed? [yes / 1 3 / no]
```

**Confirm mode (default):** STOP HERE. Wait for explicit approval before Phase 4.
- `yes` → execute all HIGH-VALUE candidates (PVS ≥ 24) in the recommended order
- Numbers (e.g., `1 3`) → execute only those numbered candidates from the HIGH-VALUE list; Phase 5 iterates only those positions
- `no` → abort — print the skipped reasons, execute Brain Write (status: blocked), then exit
- Any medium-value candidate must be named explicitly by number to be included

**Auto mode:** proceed immediately with all HIGH-VALUE candidates.

---

## Phase 4 — Pre-Execution Setup

Before writing any code:

### 4A — Snapshot

Generate a timestamp and save it — reuse the exact same value in Phase 5's diff call:
```
SNAPSHOT_NAME = "pre-techport-" + new Date().toISOString().replace(/[:.]/g, '-').slice(0,19)
Call mcp__monomind__monograph_snapshot({ name: SNAPSHOT_NAME })
```

### 4B — Resolve All Collisions First

For each collision from Phase 2B, apply the resolution strategy before any file is written.
Document the final naming decisions:

```
NAMING DECISIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source name        → Monomind name         Reason
─────────────────────────────────────────────────
SourceClass        → MonoTargetThing       new capability, no conflict
SourceConfig       → GraphConfig (extend)  extends existing monomind GraphConfig
SourceSession      → PortedSession         SessionAgent collision — disambiguate
...
```

### 4C — Brand Contamination Audit (Dry Run)

```bash
# Find ALL occurrences of source brand before touching anything
rg -i "{source_brand}" "{source_path}" --glob "!dist" --glob "!node_modules" --json | \
  python3 -c "import sys,json; lines=[json.loads(l) for l in sys.stdin if l.strip()]; \
  matches=[l for l in lines if l.get('type')=='match']; \
  print(f'Brand occurrences to clean: {len(matches)}')"
```

Verify that any candidate whose source files appeared in the gitleaks report from Phase 1D is NOT in the approved list. (It should already be in SKIPPED in the Phase 3 plan — this is a safety double-check only. If somehow a secrets-contaminated file is in the approved list, STOP and tell the user before proceeding.)

---

## Phase 5 — Execution with Mono Branding Normalization

For each approved item, in recommended order.

### Branding Rules (apply to EVERY ported item)

**Naming conventions — enforce exactly:**

| Element | Convention | Example |
|---------|-----------|---------|
| File names | kebab-case | `agent-pool.ts`, `hook-handler.ts` |
| Class / abstract class | PascalCase, domain prefix | `GraphNode`, `SwarmCoordinator`, `HookHandler` |
| Interfaces | PascalCase, no `I` prefix | `AgentConfig`, `PortedResult` |
| Skills (SKILL.md) | `mono<domain>` prefix | `monomotion`, `monograph`, `monodesign` |
| Exported functions | camelCase, no prefix | `buildGraph()`, `resolveAgent()` |
| Config keys | camelCase | `projectRoot`, `maxAgents` |
| Env vars | `MONOMIND_*` uppercase | `MONOMIND_PORT`, `MONOMIND_LOG_LEVEL` |
| npm packages | `@monomind/<name>` | `@monomind/hooks` |
| CLI commands | `monomind <command>` | `monomind agent spawn` |
| Error classes | extend monomind hierarchy | `class PortedError extends CLIError {}` |
| Event names | `domain:action` kebab | `'hook:fired'`, `'agent:spawned'` |
| Log prefixes | `[MODULE]` or `[monomind]` | `[GraphBuilder]`, `[monomind]` |
| Barrel files | `index.ts` per directory | every new directory gets one |
| Async model | async/await only | no `.then()` chains, no callbacks |
| DI style | constructor injection | no decorators, no DI container |
| Socket/IPC paths | `.monomind/` directory | `~/.monomind/ported.sock` |
| Config file on disk | `.monomind/` directory | `.monomind/ported-config.json` |

**Naming prefix rules:**
- Domain-specific public types: use domain noun as prefix (`GraphNode`, `AgentPool`, `SwarmConfig`)
- Cross-cutting types: use `Monomind` prefix (`MonomindConfig`, `MonomindSession`)
- Skill names: use `mono<shortdomain>` (`monomotion`, `monograph`) — not the source project name
- Do NOT use the source project's brand name anywhere in the ported code, even in comments — exception: a single attribution comment per file (see below)

### Attribution Rule

In every ported file, add exactly one attribution comment at the top (not in every function):
```typescript
// Pattern adapted from <source_project_name> — rebranded for monomind
```
No other references to the source brand should appear anywhere in the file.

---

### Strategy (a) — Copy-As-Is (with brand normalization)

1. Read source file completely
2. Run brand contamination check: `rg -i "{source_brand}" {file}` — note all occurrences
3. Adapt file:
   - Update import paths to monomind conventions
   - Apply all naming convention rewrites (see table above)
   - Replace `process.env.SOURCE_*` → `process.env.MONOMIND_*`
   - Replace source error classes with monomind error hierarchy
   - Replace source event names with monomind event naming
   - Replace source log prefixes with `[ModuleName]`
   - Remove all source-brand string literals from comments (keep single attribution)
   - Strip any brand-specific URLs, badges, or README references
4. Write to monomind location:
   - Skills → `.claude/skills/<mono-name>/SKILL.md`
   - Commands → `.claude/commands/<namespace>/<name>.md`
   - Agents → `.claude/agents/<category>/<name>.md`
   - Helpers → `.claude/helpers/<name>.cjs`
   - Source code → `packages/@monomind/cli/src/<module>/`
5. If it's a skill or command: add CLAUDE.md Behavioral Rule with new mono-branded name
6. Final verification: `rg -i "{source_brand}" {written_file}` must return zero results (exception: single attribution comment)

### Strategy (b) — Adapt-And-Port (with brand normalization)

1. Read source module using Interface-Boundary Focus: read imports and exports first, categorize as (a) stdlib, (b) internal, (c) external
2. List all framework-specific imports → find monomind equivalent for each
3. Map source error model → monomind CLIError hierarchy
4. Map source async model → async/await if not already
5. Write the adapted file applying all branding rules from the table above
6. Add a minimal test covering the public interface invariants
7. Final verification: `rg -i "{source_brand}" {written_file}` → zero results

### Strategy (c) — Extract-Pattern-And-Rewrite

1. Read source module — use Hierarchical Summarization:
   - What does it do? (1 sentence)
   - What is its public API contract?
   - What hidden assumptions does it make?
   - What invariants does it maintain?
2. Write a completely new implementation in monomind's TypeScript style:
   - No code from source is copied, even partially
   - Types named per monomind MNS (see table)
   - Error handling via monomind error hierarchy
   - Async/await throughout
   - Constructor injection for dependencies
   - `index.ts` barrel for directory
3. Add attribution comment: `// Pattern adapted from <source_project_name> — rewritten for monomind`
4. Write tests covering the invariants from step 1

### Strategy (d) — Inspiration-Only

1. Read the source to understand the design decisions
2. Document the insight in conversation only (no files)
3. No code copied, no file written
4. Note for the user: "Inspired by <source_project_name>'s approach to X — implemented independently"

---

### Post-Port Verification (Every Item)

After writing each file:

```bash
# 1. Zero brand contamination (hard gate — do NOT proceed to next candidate if this fails)
if rg -i "{source_brand}" "{written_file}" | grep -v "Pattern adapted from" | grep -q .; then
  echo "FAIL: brand contamination — STOP. Fix all occurrences in {written_file} before continuing."
  exit 1
else
  echo "OK: clean"
fi

# 2. TypeScript validity
cd /Users/morteza/Desktop/tools/monobrain && npx tsc --noEmit --project packages/@monomind/cli/tsconfig.json 2>&1 | tail -10

# 3. Convention spot check
cat {written_file} | grep -E "^export class|^export interface|^export function" | head -20
```

---

### After All Items

```bash
# Rebuild monomind graph
Call mcp__monomind__monograph_build({ codeOnly: true })

# Show what changed
Call mcp__monomind__monograph_diff({ from: SNAPSHOT_NAME, to: "live" })
```

**Print port summary:**
```
PORT SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ported:   <N items with strategy and mono-branded name>
Skipped:  <N items with reason>
Graph:    +<N> nodes, +<N> edges
Clean:    brand contamination = 0 across all ported files

NEXT STEPS
1. Run tests: cd packages/@monomind/cli && npm test
2. Wire new skills/commands to CLAUDE.md if not already done
3. <any follow-up suggestions>
```

---

## Output Schema (Brain Write — mastermind:master compatible)

After Phase 3 (analysis) or Phase 5 (execution), write brain output using `_protocol.md` Unified Output Schema — the required fields must be present exactly, with techport-specific data embedded in `artifacts` and `decisions`:

```yaml
# _protocol.md Unified Output Schema — namespace: mastermind:techport:raw
domain: techport
status: analysis_complete | port_complete | blocked
artifacts:
  # techport-specific metadata embedded here
  source_path:    <absolute path analyzed>
  source_brand:   <extracted PascalCase brand name>
  phase:          3  # or 5 if execution ran
  license:        <spdx identifier>
  port_permission: proceed | proceed_restricted | stop_inspiration | stop_proprietary
  risk_score:     <number>
  risk_level:     low | medium | high | critical
  files_written:  []   # populated in Phase 5; empty if phase == 3
  brand_clean:    true | false  # populated in Phase 5
  tsc_errors:     <count>        # populated in Phase 5

decisions:
  - id: techport-candidate-1
    choice: <OriginalName> → <MonoName> via strategy (a|b|c|d)
    rationale: "PVS=<N>, risk=<N>, fills gap: <one-line>"
    confidence: <0.0–1.0>
  # repeat per approved candidate

lessons: []       # add any surprising architectural findings here
next_actions:
  - "Run: cd packages/@monomind/cli && npm test"
  - "Wire new skill/command to CLAUDE.md if not already done"
  - "<any follow-up suggestions>"
board_url: ""     # leave empty; techport has no Kanban board
run_id: techport-<timestamp>
```

---

## Invariants (Always Enforced)

- NEVER port GPL / AGPL / proprietary code — Inspiration-Only and tell user why
- NEVER copy files containing secrets found by gitleaks — STOP and report
- NEVER use the source project's brand name in ported code (exception: single attribution comment per file)
- NEVER overwrite an existing monomind file without reading it first
- NEVER proceed past Phase 3 in confirm mode without explicit approval
- NEVER port test fixtures, seed data, or hardcoded example data
- ALWAYS resolve naming collisions before writing any code (Phase 4B must complete first)
- ALWAYS run `rg -i "{source_brand}"` verification after each written file
- ALWAYS add `index.ts` barrel for any new directory created
- ALWAYS use `async/await` — never port `.then()` chains or callback patterns without converting
