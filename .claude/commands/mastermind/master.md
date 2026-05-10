---
name: mastermind-master
description: Mastermind top-level orchestrator — receives any business prompt, loads the brain, decomposes into domains, spawns domain manager agents via Task tool, synthesizes results, and writes back to the brain. The single entry point for full business automation.
---

**If $ARGUMENTS is empty:** Output the capability menu below and wait.

---

**MASTERMIND** — autonomous business execution across specialist domains.

Describe your goal. Mastermind identifies the relevant domains, spawns specialist agents in parallel, and synthesizes results. Or invoke a domain directly.

---

**Build & ship**
`/mastermind:build` — code, features, bug fixes, test suites
`/mastermind:architect` — system structure, DDD, deduplication, migration (`--scope review|design|deduplicate|migrate|all`)
`/mastermind:idea` — products, features, pivots, opportunity framing
`/mastermind:content` — blog, threads, documentation, newsletters

**Understand & decide**
`/mastermind:research` — market intelligence, competitors, user insights
`/mastermind:review` — code quality, content critique, strategy audit
`/mastermind:brain` — inspect and manage business memory

**Go to market & operate**
`/mastermind:marketing` — campaigns, copy, SEO, social strategy
`/mastermind:sales` — outreach, proposals, pipeline management
`/mastermind:release` — versioning, changelogs, deployment
`/mastermind:ops` — workflow automation, process reporting
`/mastermind:finance` — invoicing, forecasting, cost tracking

**Persistent agent orgs** — named teams that coordinate across sessions
`/mastermind:createorg` — define an org: roles, hierarchy, goal
`/mastermind:runorg` — start a saved org; boss agent assigns work to all roles

---
Flags: `--auto` · `--confirm` · `--project <name>` · `--iterate <N>`

---

**If $ARGUMENTS is non-empty:** Execute the full flow below.

---

## Execution Flow

### Step 1 — Parse flags

Extract from `$ARGUMENTS`:
- `--auto` → mode = auto
- `--confirm` → mode = confirm
- `--project <name>` → project_name = <name>
- `--iterate <N>` → iterate = N (integer ≥ 1; when flag is absent, no iteration runs)
- Remaining text = prompt

### Step 2 — Brain Load

Follow the Brain Load Procedure from `_protocol.md`:

1. Call `mcp__monomind__agentdb_hierarchical-recall` namespace `mastermind:principles` (limit 20)
2. For each domain that appears relevant to the prompt, call `mcp__monomind__agentdb_context-synthesize` namespace `mastermind:<domain>:weekly`
3. Call `mcp__monomind__monograph_query` with 3-5 keywords from the prompt

Assemble the BRAIN CONTEXT block from results.

### Step 3 — Intake

Invoke the intake logic from `_intake.md`:

- Check if prompt is rich (≥20 words + domain signals + goal phrase)
- If vague: ask intake questions one at a time (Q1–Q5, stop when enough context)
- If user says "decide yourself": make explicit LLM decision, state it, log it with confidence 0.7
- Resolve: mode (auto/confirm), project_name, domains_needed

**After intake resolves:** Assign shell variables from the intake outputs (these are LLM-resolved values that must be echoed into the bash environment before the curl block runs):
- `resolved_prompt` = the full cleaned prompt string
- `mode` = `"auto"` or `"confirm"`

Then generate `SESSION_ID` and persist it so iteration cycles can retrieve it across separate Bash calls:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_ID="mm-$(date -u +%Y%m%dT%H%M%S)"
mkdir -p "$REPO_ROOT/.monomind/sessions"
# Persist SESSION_ID and project context so Step 12 can restore it in a new shell
jq -n --arg sid "$SESSION_ID" --arg proj "$project_name" --arg prompt "$resolved_prompt" \
  '{sessionId:$sid,project_name:$proj,prompt:$prompt}' \
  > "$REPO_ROOT/.monomind/sessions/current.json.tmp" \
  && mv "$REPO_ROOT/.monomind/sessions/current.json.tmp" \
        "$REPO_ROOT/.monomind/sessions/current.json"
curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg sid "$SESSION_ID" --arg prompt "$resolved_prompt" --arg mode "$mode" --arg proj "$(pwd)" \
    '{type:"session:start",session:$sid,prompt:$prompt,mode:$mode,project:$proj,ts:(now*1000|floor)}')" || true
```

### Step 4 — Decompose

For each domain in `domains_needed`, assess complexity:
- **Simple** (skill-only): single task, single agent, < 30 minutes estimated — invoke skill directly
- **Complex** (manager agent): multi-step, multi-file, multi-day, or multi-agent — spawn a Task agent

Complexity threshold for manager agent: any of these is true:
- Requires 3+ files to be created/modified
- Requires 2+ specialized agent types
- Has external dependencies (APIs, services)
- Is estimated to take more than one conversation turn

**Per-domain goal extraction:** For each activated domain, extract a one-sentence goal from the prompt describing what that domain must accomplish. Then **run the following Bash block**, substituting `<domain_goals_json>` with a JSON object mapping each domain name to its one-sentence goal (use the full `resolved_prompt` as the value for any domain where no specific goal is extractable):

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
[ -f "$SESSION_STATE" ] || { echo "ERROR: current.json not found"; exit 1; }

# LLM: write the extracted goals JSON object to the temp file below.
# Use a file (not a shell variable) to avoid quoting issues with apostrophes in goal text.
# Example content: {"build":"Ship the auth module","marketing":"Draft launch email series"}
# One JSON object, keys = domain names, values = one-sentence goals.
SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing in current.json — run Step 3 first"; exit 1; }
GOALS_FILE="$REPO_ROOT/.monomind/sessions/${SESSION_ID}_goals.json"
cat > "$GOALS_FILE" << 'GOALS_EOF'
<domain_goals_json>
GOALS_EOF

# Validate it's real JSON before merging
jq . "$GOALS_FILE" > /dev/null 2>&1 || { echo "ERROR: domain_goals_json is not valid JSON — check LLM substitution"; exit 1; }

jq --slurpfile goals "$GOALS_FILE" '. + {domain_goals:$goals[0]}' \
  "$SESSION_STATE" > "$SESSION_STATE.tmp" && mv "$SESSION_STATE.tmp" "$SESSION_STATE"
echo "Domain goals written to current.json"
```

### Step 5 — Plan Output

Build a plan summary:

```
MASTERMIND PLAN — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Prompt: <prompt>
Mode: <auto|confirm>

Domains activated:
  ✦ build → Development Manager agent → board: <project>/development (will be created in Step 6)
  ✦ marketing → Marketing Manager agent → board: <project>/marketing (will be created in Step 6)

Monotask space: <project_name>
Brain loaded: <N> principles, <M> domain summaries
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

If mode = confirm: show plan and wait for user response. Valid responses:
- "go" or "proceed" — continue immediately
- Any modification (e.g. "add sales domain", "remove marketing") — apply the change, re-show the plan, wait again
- "cancel" or "stop" — emit `session:complete` with `status: blocked`, reason "cancelled by user", then STOP

If mode = auto: proceed immediately.

### Step 6 — Monotask Setup

Follow the Monotask Space+Board Setup Procedure from `_protocol.md`. Resolve the space **once**, then create one board per active domain. Use `project_name` as the space name so all boards across repos and domains share the same space.

```bash
# Require bash 4.3+ for associative arrays and namerefs (local -n introduced in 4.3)
# macOS ships bash 3.2; install via: brew install bash
(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 403 )) && \
  { echo "ERROR: bash 4.3+ required for namerefs (current: $BASH_VERSION). Install: brew install bash"; exit 1; }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"

# Reload persisted context (this is a fresh shell; Step 3 wrote these)
SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing in current.json — run Step 3 first"; exit 1; }
project_name=$(jq -r '.project_name // ""' "$SESSION_STATE")
[ -z "$project_name" ] && { echo "ERROR: project_name is empty in current.json — run Step 3 first"; exit 1; }
resolved_prompt=$(jq -r '.prompt // ""' "$SESSION_STATE")

# domains_needed: NOT yet in current.json at this point — must be LLM-substituted inline.
# LLM: replace DOMAINS_LIST_HERE with space-separated domain names, e.g.: build marketing sales
# Domain names must be single words (no spaces). Example: "build marketing sales"

# Resolve space once for all domains
# Use awk with literal pipe to avoid BSD awk \| regex fragility
space_id=$(monotask space list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$2); if($2==n) gsub(/^ +| +$/,"",$1); if($2==n) print $1}' n="$project_name" | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }

# Associative arrays — no eval, no injection risk
declare -A board_ids todo_cols doing_cols done_cols domain_goals

# Hydrate domain_goals from Step 4's current.json write — prevents Step 4 extraction being clobbered
while IFS=$'\t' read -r k v; do
  [[ -n "$k" ]] && domain_goals[$k]="$v"
done < <(jq -r '.domain_goals // {} | to_entries[] | [.key,.value] | @tsv' "$SESSION_STATE" 2>/dev/null)

# Loop over every active domain — LLM: replace DOMAINS_LIST_HERE with the resolved domain list
domains_needed="DOMAINS_LIST_HERE"
[ "$domains_needed" = "DOMAINS_LIST_HERE" ] && { echo "ERROR: LLM did not substitute DOMAINS_LIST_HERE with domain names"; exit 1; }
[ -z "$domains_needed" ] && { echo "ERROR: domains_needed is empty — nothing to do"; exit 1; }
for domain in $domains_needed; do
  board_id=$(monotask board create "$domain" --json | jq -r '.id // empty')
  [ -z "$board_id" ] && { echo "ERROR: Failed to create $domain board"; exit 1; }
  monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 \
    || echo "WARN: could not attach $domain board to space $space_id (non-fatal)"
  todo_col=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id // empty')
  [ -z "$todo_col" ] && { echo "ERROR: Failed to create Todo column for $domain"; exit 1; }
  doing_col=$(monotask column create "$board_id" "Doing" --json | jq -r '.id // empty')
  [ -z "$doing_col" ] && { echo "ERROR: Failed to create Doing column for $domain"; exit 1; }
  done_col=$(monotask column create "$board_id" "Done"  --json | jq -r '.id // empty')
  [ -z "$done_col" ] && { echo "ERROR: Failed to create Done column for $domain"; exit 1; }
  board_ids[$domain]=$board_id
  todo_cols[$domain]=$todo_col
  doing_cols[$domain]=$doing_col
  done_cols[$domain]=$done_col
  # Fall back to full prompt only for domains not extracted by Step 4
  [ -z "${domain_goals[$domain]}" ] && domain_goals[$domain]="$resolved_prompt"
done

# Persist all session state needed by later shells — board/col IDs, goals, domain list
# (each Bash tool call is a fresh shell — associative arrays don't survive)
_to_json_map() {
  local -n _arr=$1
  for k in "${!_arr[@]}"; do
    jq -n --arg k "$k" --arg v "${_arr[$k]}" '{key:$k,value:$v}'
  done | jq -s 'from_entries // {}'
}
domains_goals_json=$(_to_json_map domain_goals)
board_ids_json=$(_to_json_map board_ids)
todo_cols_json=$(_to_json_map todo_cols)
doing_cols_json=$(_to_json_map doing_cols)
done_cols_json=$(_to_json_map done_cols)

jq --arg domains "$domains_needed" \
   --argjson goals "$domains_goals_json" \
   --argjson boards "$board_ids_json" \
   --argjson todos "$todo_cols_json" \
   --argjson doings "$doing_cols_json" \
   --argjson dones "$done_cols_json" \
  '. + {domains_needed:($domains | split(" ") | map(select(length>0))),
         domain_goals:$goals, board_ids:$boards,
         todo_cols:$todos, doing_cols:$doings, done_cols:$dones}' \
  "$REPO_ROOT/.monomind/sessions/current.json" > "$REPO_ROOT/.monomind/sessions/current.json.tmp" \
  && mv "$REPO_ROOT/.monomind/sessions/current.json.tmp" "$REPO_ROOT/.monomind/sessions/current.json"
```

### Step 7 — Spawn Domain Managers

**Before spawning**, select the best domain manager agent type from the registry for each active domain. Do not hardcode `coordinator` — pick the agent whose expertise best fits the domain goal.

**Phase A — Registry selection** (run as one Bash call; must complete before Phase C):

```bash
# Require bash 4.3+ for associative arrays and namerefs
(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 403 )) && \
  { echo "ERROR: bash 4.3+ required (current: $BASH_VERSION). Install: brew install bash"; exit 1; }

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY="$REPO_ROOT/.monomind/registry.json"

# Reload state from current.json — this is a new shell; no inherited variables
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
[ -f "$SESSION_STATE" ] || { echo "ERROR: current.json not found — run from Step 3"; exit 1; }
domains_needed=$(jq -r '.domains_needed[]? // empty' "$SESSION_STATE" | tr '\n' ' ')
[ -z "$domains_needed" ] && { echo "ERROR: domains_needed is empty in current.json"; exit 1; }

# Returns: best agent name from registry for the given domain+goal
pick_domain_manager() {
  local domain="$1"
  local goal="$2"
  local kw cats result
  kw=$(echo "$goal" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z]{5,}' | sort -u | tr '\n' ' ')
  case "$domain" in
    build)     cats="engineering development architecture" ;;
    marketing) cats="marketing paid-media strategy" ;;
    sales)     cats="sales strategy" ;;
    research)  cats="academic specialized strategy" ;;
    content)   cats="marketing specialized" ;;
    ops)       cats="project-management strategy support" ;;
    release)   cats="devops github engineering" ;;
    review)    cats="engineering testing analysis" ;;
    finance)   cats="strategy specialized" ;;
    architect) cats="architecture engineering" ;;
    idea)      cats="product strategy marketing" ;;
    *)         cats="core strategy" ;;
  esac
  result=$(jq -r \
    --arg cats "$cats" \
    --arg kw "$kw" \
    '[ .agents[] | select(.deprecated != true)
       | select(.category as $c | ($cats | split(" ") | any(. == $c)))
       | {name: .name,
          score: (
            (.name | ascii_downcase) as $n |
            # Score on ANY keyword match, not just the first
            (if ($kw | length) > 0
             then ([$kw | split(" ")[] | select(length > 0) | if ($n | contains(.)) then 1 else 0 end] | add // 0)
             else 0 end) +
            (if $n | test("manager|director|coordinator") then 1 else 0 end)
          )}
     ] | sort_by(-.score) | .[0].name // empty' \
    "$REGISTRY" 2>/dev/null)
  if [ -z "$result" ]; then
    echo "WARN: registry lookup failed for domain=$domain, using coordinator fallback" >&2
    echo "coordinator"
  else
    echo "$result"
  fi
}

declare -A domain_managers
for domain in $domains_needed; do
  goal=$(jq -r --arg d "$domain" '.domain_goals[$d] // empty' "$SESSION_STATE")
  [ -z "$goal" ] && goal=$(jq -r '.prompt // ""' "$SESSION_STATE")
  manager=$(pick_domain_manager "$domain" "$goal")
  domain_managers[$domain]="$manager"
  echo "Domain manager for $domain: $manager"
done

# Persist domain_managers so Phase C can reload them without stdout parsing
domain_managers_json=$(for k in "${!domain_managers[@]}"; do
  jq -n --arg k "$k" --arg v "${domain_managers[$k]}" '{key:$k,value:$v}'
done | jq -s 'from_entries // {}')
[ -z "$domain_managers_json" ] && domain_managers_json="{}"
jq --argjson mgrs "$domain_managers_json" '. + {domain_managers:$mgrs}' \
  "$SESSION_STATE" > "$SESSION_STATE.tmp" && mv "$SESSION_STATE.tmp" "$SESSION_STATE"

# Emit board/column lookup for LLM use in Phase C Task construction:
echo "--- Phase C board/col IDs (loaded from current.json) ---"
for domain in $domains_needed; do
  board=$(jq -r --arg d "$domain" '.board_ids[$d] // ""' "$SESSION_STATE")
  todo=$(jq -r --arg d "$domain" '.todo_cols[$d] // ""' "$SESSION_STATE")
  doing=$(jq -r --arg d "$domain" '.doing_cols[$d] // ""' "$SESSION_STATE")
  done_c=$(jq -r --arg d "$domain" '.done_cols[$d] // ""' "$SESSION_STATE")
  mgr=$(jq -r --arg d "$domain" '.domain_managers[$d] // "coordinator"' "$SESSION_STATE")
  echo "DOMAIN=$domain MANAGER=$mgr BOARD=$board TODO=$todo DOING=$doing DONE=$done_c"
done
```

**Phase B — Dashboard dispatch** + **Phase C — Task spawning** (run in one message — B is a Bash call, C is the Task tool calls; they are independent of each other):

Phase B:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID not found in current.json"; exit 1; }
domains_needed=$(jq -r '.domains_needed[]? // empty' "$SESSION_STATE" | tr '\n' ' ')
for domain in $domains_needed; do
  goal=$(jq -r --arg d "$domain" '.domain_goals[$d] // empty' "$SESSION_STATE")
  [ -z "$goal" ] && goal=$(jq -r '.prompt // ""' "$SESSION_STATE")
  curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn --arg sid "$SESSION_ID" --arg d "$domain" --arg cmd "$goal" \
      '{type:"domain:dispatch",session:$sid,domain:$d,cmd:$cmd,ts:(now*1000|floor)}')" || true
done
```

Spawn ALL domain manager agents in ONE message using the Task tool (parallel execution).

**Before constructing the Task calls:** load board/column UUIDs and domain manager names from `current.json` — that is the authoritative source. The Phase A echo lines are a human-readable diagnostic only; do not parse them as the primary data source.

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing"; exit 1; }

# Emit one line per domain for LLM to read before constructing Task calls
for domain in $(jq -r '.domains_needed[]? // empty' "$SESSION_STATE"); do
  echo "DOMAIN=$domain \
MANAGER=$(jq -r --arg d "$domain" '.domain_managers[$d] // "coordinator"' "$SESSION_STATE") \
BOARD=$(jq -r --arg d "$domain" '.board_ids[$d] // ""' "$SESSION_STATE") \
TODO=$(jq -r --arg d "$domain" '.todo_cols[$d] // ""' "$SESSION_STATE") \
DOING=$(jq -r --arg d "$domain" '.doing_cols[$d] // ""' "$SESSION_STATE") \
DONE=$(jq -r --arg d "$domain" '.done_cols[$d] // ""' "$SESSION_STATE") \
GOAL=$(jq -r --arg d "$domain" '.domain_goals[$d] // .prompt' "$SESSION_STATE" | tr -d '\n')"
done
```

Use each `MANAGER` value as `subagent_type`, `BOARD`/`TODO`/`DOING`/`DONE` as board and column IDs. Do NOT use placeholder strings.

Each Task call must include a complete briefing following the Monotask Task Briefing Standard from `_protocol.md`. Include:
- The full BRAIN CONTEXT block
- The board ID (from `current.json` above)
- The specific goal for this domain
- The project name and run context
- Instruction to create monotask cards directly using `monotask card create $BOARD_ID $COL_TODO_ID "<title>" --json` for all sub-tasks
- Instruction to use `/monomind:do` to execute
- Instruction to spawn specialized agents using the domain-appropriate swarm topology
- Instruction to return the unified output schema when done

Example Task call for Development Manager. Substitute every `<…>` placeholder with its resolved value before calling Task. `subagent_type` is the **string value** of `$domain_manager_build` (e.g. `"Backend Architect"`), not a variable reference.

**IMPORTANT — `<SESSION_ID>` appears 6 times in the template below. ALL must be replaced with the resolved value:**
1. `SESSION ID: <SESSION_ID>` — the header line in the prompt
2. `--arg sid '<SESSION_ID>'` in the agent:spawn curl call
3. `--arg sid '<SESSION_ID>'` in the intercom curl call
4. `mkdir -p "…/sessions/<SESSION_ID>"` — the output directory
5. `> "…/sessions/<SESSION_ID>/build.json"` — the output file path
6. `--arg sid '<SESSION_ID>'` in the domain:complete curl call

Missing any one causes silent failures (output files written to a literal `<SESSION_ID>` directory that doesn't exist; Step 9 finds nothing and reports `complete` with zero domains).

```javascript
Task({
  subagent_type: "<value of domain_manager_build, e.g. Backend Architect>",
  description: "Development Manager for project <project_name>",
  run_in_background: false,   // foreground so Step 8 can collect output synchronously
  prompt: "You are the Development Manager for project <project_name>.\n\n" +
    "CONTEXT: Mastermind run <date> | Project: <project_name> | Master spawned you.\n\n" +
    "SESSION ID: <SESSION_ID> — use in all dashboard events below.\n\n" +
    "BRAIN CONTEXT:\n<paste brain context here>\n\n" +
    "YOUR BOARD: <board_build> (monotask://<project_name>/build)\n" +
    "TODO COL: <todo_col_build> | DOING COL: <doing_col_build> | DONE COL: <done_col_build>\n\n" +
    "GOAL: <build_goal>\n\n" +
    "YOUR RESPONSIBILITIES:\n" +
    "1. Break this goal into discrete tasks using:\n" +
    "   monotask card create <board_build> <todo_col_build> '<title>' --json\n" +
    "   Each card description MUST include: context, goal, scope, constraints, success criteria, agent, dependencies.\n\n" +
    "2. Spawn specialized agents for each task using the Task tool:\n" +
    "   - Backend work: subagent_type 'backend-dev'\n" +
    "   - Frontend work: subagent_type 'frontend-dev'\n" +
    "   - Testing: subagent_type 'tester'\n" +
    "   - Code review: subagent_type 'reviewer'\n" +
    "   Default swarm: hierarchical 6 agents raft\n\n" +
    "3. BEFORE spawning each agent, emit agent:spawn via curl (NOT WebFetch — use jq for correct ms timestamps):\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d \"$(jq -cn --arg sid '<SESSION_ID>' --arg agent '<slug>' --arg task '<title>' \\\n" +
    "       '{type:\"agent:spawn\",session:$sid,domain:\"build\",agent:$agent,task:$task,ts:(now*1000|floor)}')\" || true\n\n" +
    "4. If handing off artifacts to another domain, emit intercom via curl:\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d \"$(jq -cn --arg sid '<SESSION_ID>' --arg to '<domain>' --arg msg '<summary>' \\\n" +
    "       '{type:\"intercom\",session:$sid,from:\"build\",to:$to,msg:$msg,ts:(now*1000|floor)}')\" || true\n\n" +
    "5. Execute tasks via /monomind:do --board <board_build>\n" +
    "6. Collect all agent outputs\n\n" +
    "7. BEFORE returning, write your output schema to disk AND emit domain:complete:\n" +
    "   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)\n" +
    "   mkdir -p \"$REPO_ROOT/.monomind/sessions/<SESSION_ID>\"\n" +
    "   jq -n --arg domain 'build' --arg status '<status>' \\\n" +
    "     --argjson artifacts '[\"<path1>\",\"<path2>\"]' \\\n" +
    "     --argjson next_actions '[\"<action1>\"]' \\\n" +
    "     '{domain:$domain,status:$status,artifacts:$artifacts,next_actions:$next_actions}' \\\n" +
    "     > \"$REPO_ROOT/.monomind/sessions/<SESSION_ID>/build.json\"\n" +
    "   curl -s -o /dev/null -X POST http://localhost:4242/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d \"$(jq -cn --arg sid '<SESSION_ID>' --arg status '<status>' \\\n" +
    "       '{type:\"domain:complete\",session:$sid,domain:\"build\",status:$status,ts:(now*1000|floor)}')\" || true\n\n" +
    "8. Return unified output schema:\n" +
    "   domain: build\n" +
    "   status: complete|partial|blocked\n" +
    "   artifacts: [...]\n" +
    "   decisions: [...]\n" +
    "   lessons: [...]\n" +
    "   next_actions: [...]\n" +
    "   board_url: monotask://<project_name>/build\n" +
    "   run_id: <ISO8601-timestamp>"
})
```

### Step 8 — Collect Reports

Domain managers run in foreground (no `run_in_background`), so their unified output schemas are returned synchronously as each Task call completes. Each domain manager writes its canonical output schema to `.monomind/sessions/<SESSION_ID>/<domain>.json` before returning — that file is the source of truth for Step 9 aggregation. The Task tool's text return value is informational only; do not attempt to parse it as JSON. If a manager reports `status: blocked`, record it but continue collecting from all others — do not abort the run.

### Step 9 — Synthesize

1. Collect all domain output schemas from Step 8
2. Compute aggregate status — read from per-domain output files (precedence: blocked > partial > complete):

```bash
# Single bash block: aggregate status + emit dashboard event
# (variables don't persist between Bash tool calls — keep aggregation and curl together)
(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 400 )) && \
  { echo "ERROR: bash 4+ required (current: $BASH_VERSION). Install: brew install bash"; exit 1; }
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_ID=$(jq -r '.sessionId // empty' "$REPO_ROOT/.monomind/sessions/current.json" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing"; exit 1; }

overall_status="complete"
completed_domains=()
found_domain_files=0
for domain_file in "$REPO_ROOT/.monomind/sessions/${SESSION_ID}"/*.json; do
  [ -f "$domain_file" ] || continue
  domain=$(jq -r '.domain // ""' "$domain_file")
  [ -z "$domain" ] && continue  # skip auxiliary files that aren't domain output schemas
  found_domain_files=$(( found_domain_files + 1 ))
  status=$(jq -r '.status // "blocked"' "$domain_file")
  case "$status" in
    blocked) overall_status="blocked" ;;
    partial) [ "$overall_status" != "blocked" ] && overall_status="partial" ;;
  esac
  [ "$status" = "complete" ] && completed_domains+=("$domain")
done
(( found_domain_files == 0 )) && { overall_status="blocked"; echo "WARN: no domain output files found for session $SESSION_ID — all domain managers may have failed"; }
echo "overall_status=$overall_status completed_domains=${completed_domains[*]}"

completed_domains_json=$(jq -n '$ARGS.positional' --args "${completed_domains[@]}")

curl -s -o /dev/null -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg sid "$SESSION_ID" \
    --arg status "$overall_status" \
    --argjson domains "$completed_domains_json" \
    '{type:"session:complete",session:$sid,status:$status,domains:$domains,ts:(now*1000|floor)}')" || true
```

3. Identify any cross-domain artifacts needed (e.g. a release that requires both build and review)
4. Write cross-domain artifacts to disk if needed
5. Compose the action summary for the user:

```
MASTERMIND RUN COMPLETE — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: complete | partial | blocked

Domains completed: build ✓ | marketing ✓
Domains blocked: (none)

Artifacts produced:
  /path/to/file1 (code)
  /path/to/file2 (copy)

Key decisions made:
  • [what] — [why] (confidence: X)

Next actions suggested:
  • /mastermind:review --project <project_name>
  • /mastermind:release --project <project_name>

Monotask boards:
  → monotask://<project_name>/development
  → monotask://<project_name>/marketing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Step 10 — Brain Write

Follow the Brain Write Procedure from `_protocol.md` for each domain that ran:
1. Score all decisions from this run
2. Append to Tier 1 raw log (AgentDB)
3. Check and trigger weekly compaction if threshold met
4. Check and trigger graph consolidation if cluster detected

### Step 11 — Output to User

Show the action summary (Step 9). If any compaction ran during Step 10, append:
> "Brain updated: compacted <N> entries into <M> summaries."

**Persist session state for iteration cycles:** Aggregate artifacts from per-domain output files written by each domain manager, then persist to disk so Step 12 can load it:

```bash
(( BASH_VERSINFO[0] * 100 + BASH_VERSINFO[1] < 400 )) && \
  { echo "ERROR: bash 4+ required (current: $BASH_VERSION). Install: brew install bash"; exit 1; }
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"

# Restore variables from current.json (this is a fresh shell)
SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID not found"; exit 1; }
resolved_prompt=$(jq -r '.prompt // ""' "$SESSION_STATE")
project_name=$(jq -r '.project_name // ""' "$SESSION_STATE")

# Aggregate artifacts, next_actions, completed_domains, and overall_status
# from per-domain output files (single source of truth — Step 9 shell is gone)
all_artifacts=()
all_next_actions=()
completed_domains=()
overall_status="complete"
found_domain_files=0
for domain_file in "$REPO_ROOT/.monomind/sessions/${SESSION_ID}"/*.json; do
  [ -f "$domain_file" ] || continue
  domain=$(jq -r '.domain // ""' "$domain_file")
  [ -z "$domain" ] && continue  # skip auxiliary files that aren't domain output schemas
  found_domain_files=$(( found_domain_files + 1 ))
  status=$(jq -r '.status // "blocked"' "$domain_file")
  case "$status" in
    blocked) overall_status="blocked" ;;
    partial) [ "$overall_status" != "blocked" ] && overall_status="partial" ;;
  esac
  [ "$status" = "complete" ] && completed_domains+=("$domain")
  while IFS= read -r art; do all_artifacts+=("$art"); done \
    < <(jq -r '.artifacts[]? // empty' "$domain_file" 2>/dev/null)
  while IFS= read -r act; do all_next_actions+=("$act"); done \
    < <(jq -r '.next_actions[]? // empty' "$domain_file" 2>/dev/null)
done
(( found_domain_files == 0 )) && { overall_status="blocked"; echo "WARN: no domain output files found for session $SESSION_ID"; }

artifacts_json=$(jq -n '$ARGS.positional' --args "${all_artifacts[@]}")
next_actions_json=$(jq -n '$ARGS.positional' --args "${all_next_actions[@]}")
completed_domains_json=$(jq -n '$ARGS.positional' --args "${completed_domains[@]}")

jq -n \
  --arg sessionId "$SESSION_ID" \
  --arg prompt "$resolved_prompt" \
  --arg project_name "$project_name" \
  --arg status "$overall_status" \
  --argjson completed_domains "$completed_domains_json" \
  --argjson artifacts "$artifacts_json" \
  --argjson next_actions "$next_actions_json" \
  --arg run_id "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{sessionId:$sessionId,prompt:$prompt,project_name:$project_name,status:$status,
    completed_domains:$completed_domains,artifacts:$artifacts,next_actions:$next_actions,
    run_id:$run_id}' \
  > "$REPO_ROOT/.monomind/sessions/${SESSION_ID}.json.tmp" \
  && mv "$REPO_ROOT/.monomind/sessions/${SESSION_ID}.json.tmp" \
        "$REPO_ROOT/.monomind/sessions/${SESSION_ID}.json"
```

---

### Step 12 — Iteration Loop (only if `--iterate <N>` was set and N ≥ 1)

After Step 11, run N autonomous improvement cycles. Each cycle is a full self-directed run — no user input required.

**For each cycle i = 1 … N:**

#### 12a — Assess Current State

Load fresh brain context (repeat Brain Load Procedure from `_protocol.md`). Load the persisted session state:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# Restore SESSION_ID — may be in a new shell context
SESSION_ID=$(jq -r '.sessionId // empty' "$REPO_ROOT/.monomind/sessions/current.json" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID not found in current.json — cannot continue iteration."; exit 1; }

SESSION_FILE="$REPO_ROOT/.monomind/sessions/${SESSION_ID}.json"
# Echo to stdout — bash variables don't survive tool call boundaries; only stdout is visible to the LLM
jq '{artifacts:.artifacts,next_actions:.next_actions}' "$SESSION_FILE" 2>/dev/null \
  || echo '{"artifacts":[],"next_actions":[]}'
```

Then evaluate the project's current state by examining:
- What was just completed (artifacts from the `artifacts` array printed above)
- What `next_actions` entries printed above suggest
- What the `next_actions` from all domain outputs say
- What the git diff shows (if applicable) — any test failures, TODOs, or incomplete work
- What gaps exist relative to the original prompt's success criteria

#### 12b — Decide Next Activity

Choose the single highest-value activity for this cycle. Rank candidates by this priority:

| Priority | Activity | Choose when |
|---|---|---|
| 1 | **Test** | New code exists with no test coverage, or tests failed |
| 2 | **Debug / Fix** | Tests are failing or artifacts have known errors |
| 3 | **Review** | Significant new code exists with no review pass |
| 4 | **Improve / Refactor** | Code works but has quality issues surfaced by review or brain |
| 5 | **Add feature** | Core is stable; next_actions suggest new capability aligned with project goal |
| 6 | **Research** | Significant unknowns remain before next feature can be decided |
| 7 | **Content / Docs** | Feature is complete and undocumented |
| 8 | **Release** | Project is stable, tested, reviewed — ready to ship |

State the decision explicitly:
> "Cycle <i>/<N>: I'm choosing to **<activity>** because <one-sentence reason>. Confidence: <0.0–1.0>"

Log this as a decision in the cycle's output schema with `confidence` set accordingly.

#### 12c — Execute

Execute the chosen activity by invoking the appropriate domain skill directly (Steps 4–10 of the main flow, condensed):

- Test → invoke `/mastermind:build` with a testing-focused prompt
- Debug/Fix → invoke `/mastermind:build` with the specific failing test or error as prompt
- Review → invoke `/mastermind:review` with scope = artifacts from last run
- Improve/Refactor → invoke `/mastermind:build` with refactor prompt
- Add feature → invoke `/mastermind:build` with the next feature from `$last_next_actions`
- Research → invoke `/mastermind:research` with the open question as prompt
- Content/Docs → invoke `/mastermind:content` with scope = new artifacts
- Release → invoke `/mastermind:release` with project scope

Always pass: the current brain_context, project_name, the relevant board_id, and mode = auto (iteration cycles never pause for confirmation).

#### 12d — Brain Write

Follow Brain Write Procedure from `_protocol.md` for this cycle's domain. Score and append.

#### 12e — Cycle Summary

Output a compact progress line:

```
ITERATION <i>/<N> — <activity> — <status: complete|partial|blocked>
  → <one-line summary of what was done>
  → Next cycle will: <predicted next activity based on current state>
```

If the cycle returns `status: blocked`, skip remaining cycles and report:
> "Iteration halted at cycle <i>: blocked on <reason>. Remaining <N-i> cycles skipped."

---

After all N cycles complete, output a final iteration summary:

```
ITERATION COMPLETE — <N> cycles — <project_name>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Cycle 1: test       → 12 tests added, all passing
Cycle 2: review     → 3 issues found, 2 fixed inline
Cycle 3: improve    → auth module refactored, 15% complexity reduction
...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Brain updated: <total decisions scored and logged>
Project state: <one-sentence assessment of where things stand>
Suggested next: <what a human should do or approve next>
```
