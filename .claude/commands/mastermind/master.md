---
name: mastermind-master
description: Mastermind top-level orchestrator — receives any business prompt, loads the brain, decomposes into domains, spawns domain manager agents via Task tool, synthesizes results, and writes back to the brain. The single entry point for full business automation.
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, skip the MASTERMIND PROTOCOL section below and proceed directly to execution.
</SUBAGENT-STOP>

---

## MASTERMIND PROTOCOL

<EXTREMELY-IMPORTANT>
Before ANY response or action — including clarifying questions — check whether a mastermind skill applies to what you are about to do.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST INVOKE IT.

This is not negotiable. This is not optional. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

### Instruction Priority

Mastermind skills override default system prompt behavior, but **user instructions always take precedence**:

1. **User's explicit instructions** (CLAUDE.md, direct requests, `$ARGUMENTS`) — highest priority
2. **Mastermind skills** — override default behavior where they conflict
3. **Default system prompt** — lowest priority

If CLAUDE.md says "skip review" and the skill says "always review," follow the user's instructions.

### User Instructions vs. Skill Workflows

User instructions say **WHAT** to do, not **HOW** to do it. "Build X" or "Fix Y" is a goal statement — it does not mean skip Brain Load, skip review, or bypass the domain decomposition flow. The skills define the how. Always apply the workflow unless the user explicitly opts out.

### Command-to-Skill Routing

Invoke the matching skill **before** doing anything else. Even a 1% chance a skill applies means you must check.

```
digraph mastermind_routing {
    "User command / prompt received" [shape=doublecircle];
    "Brain already loaded?" [shape=diamond];
    "Load brain (Brain Load Procedure)" [shape=box];
    "Might a mastermind skill apply?" [shape=diamond];
    "Invoke Skill() tool" [shape=box];
    "Announce: Using [skill] for [purpose]" [shape=box];
    "Execute skill exactly" [shape=box];
    "Respond or act" [shape=doublecircle];

    "User command / prompt received" -> "Brain already loaded?";
    "Brain already loaded?" -> "Load brain (Brain Load Procedure)" [label="no"];
    "Brain already loaded?" -> "Might a mastermind skill apply?" [label="yes"];
    "Load brain (Brain Load Procedure)" -> "Might a mastermind skill apply?";
    "Might a mastermind skill apply?" -> "Invoke Skill() tool" [label="yes, even 1%"];
    "Might a mastermind skill apply?" -> "Respond or act" [label="definitely not"];
    "Invoke Skill() tool" -> "Announce: Using [skill] for [purpose]";
    "Announce: Using [skill] for [purpose]" -> "Has checklist?" [shape=diamond];
    "Has checklist?" -> "Create TodoWrite item per checklist step" [label="yes"];
    "Has checklist?" -> "Execute skill exactly" [label="no"];
    "Create TodoWrite item per checklist step" -> "Execute skill exactly";
}
```

| Situation | Skill to invoke |
|---|---|
| Debug a bug, test failure, unexpected behavior | `Skill("mastermind:debug")` |
| Verify a claim — tests pass, feature works, fix resolved | `Skill("mastermind:verify")` |
| Write tests first, enforce Red-Green-Refactor | `Skill("mastermind:tdd")` |
| Write a structured implementation plan (no placeholders) | `Skill("mastermind:plan")` |
| Execute a written plan step-by-step with stop-on-blocker | `Skill("mastermind:execute")` |
| Execute a plan via fresh subagents with 2-stage review | `Skill("mastermind:taskdev")` |
| Design first — spec, approaches, approval gate before code | `Skill("mastermind:design")` |
| Build a feature, fix a bug, implement anything | `Skill("mastermind:build")` |
| Code review, content critique, strategy audit | `Skill("mastermind:review")` |
| Receive a code review and apply it correctly | `Skill("mastermind:receive-review")` |
| System architecture, DDD, technical design | `Skill("mastermind:architect")` |
| Market research, competitive analysis, user insights | `Skill("mastermind:research")` |
| Ideas, feature generation, opportunity framing | `Skill("mastermind:idea")` |
| Marketing campaign, copy, SEO | `Skill("mastermind:marketing")` |
| Sales outreach, proposals, pipeline | `Skill("mastermind:sales")` |
| Blog, docs, newsletters, threads | `Skill("mastermind:content")` |
| Versioning, changelogs, deployment | `Skill("mastermind:release")` |
| Finish a branch — tests, options menu, merge/PR/discard | `Skill("mastermind:finish")` |
| Workflow, process, reporting | `Skill("mastermind:ops")` |
| Invoicing, forecasting, cost | `Skill("mastermind:finance")` |
| Inspect or manage brain memory | `Skill("mastermind:brain")` |
| Technical portfolio, project state assessment | `Skill("mastermind:techport")` |
| Define/run an agent organization | `Skill("mastermind:createorg")` / `Skill("mastermind:runorg")` |
| Autonomous build + review until clean | `Skill("mastermind:autodev")` |
| Isolate work in a git worktree | `Skill("mastermind:worktree")` |
| Write or improve a mastermind skill | `Skill("mastermind:skill-builder")` |

### Skill Execution Order

When multiple skills could apply to a **single-skill invocation** (not a full mastermind:master multi-domain run):

1. **Process skills first** — brainstorming (`mastermind:idea`), architecture (`mastermind:architect`), research (`mastermind:research`) determine HOW to approach the work
2. **Execution skills second** — build, review, release execute the approach

"Let's build X" → `mastermind:architect` first if approach is unclear, then `mastermind:build`.
"Fix this" → `mastermind:research` to understand root cause if unknown, then `mastermind:build` to fix.
"Ship it" → `mastermind:review` to verify clean, then `mastermind:release`.

**Multi-domain runs (Steps 4–7 of this command):** Domain manager agents for different domains run concurrently — there is no enforced serial order between `build` and `architect` domain managers when both are active. The order above applies when you (the master) are choosing which single skill to invoke directly.

### Skill Types

**Rigid** (autodev, review with `--tillend`): Follow exactly. Do not skip review cycles. Do not stop early.

**Flexible** (idea, research, content): Adapt principles to context. Use judgment on scope.

The skill itself tells you which it is.

### Anti-Drift Guards

These thoughts mean **STOP** — you are rationalizing. Check for a skill first.

| Thought | Reality |
|---|---|
| "This is just a simple task" | Simple tasks define the floor. Check for skills. |
| "I need more context first" | Skill check comes BEFORE gathering context. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly before invoking a skill" | Files lack conversation context. Brain Load + skill check come first. |
| "Let me gather information first, then I'll check" | Skills tell you HOW to gather information. Check first. |
| "The brain isn't loaded yet — let me just answer" | Brain Load is the first step. Load it. |
| "This doesn't need a formal skill" | If a skill exists for this domain, use it. |
| "This doesn't count as a real task" | Action = task. Check for skills. |
| "I remember how this works" | Skills evolve. Read current version. Always. |
| "I know what that command does" | Knowing the concept ≠ invoking the skill. Invoke it. |
| "The skill is overkill for this" | Small tasks become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action creates drift. Skills prevent this. |
| "Auto mode means I should move fast" | Speed without discipline creates drift. Use skills. |
| "The user said --auto, so I skip confirmation" | --auto skips user confirmation. It does NOT skip skill invocation. |
| "Spawned agents don't need to check skills" | Subagents that have Skill access MUST use it. Only subagents with the `<SUBAGENT-STOP>` gate may skip. |

### Mandatory Patterns

These sequences are non-negotiable in all modes:

- **Before building**: Load brain → `mastermind:design` if approach is unclear → `mastermind:plan` for complex work → then build
- **When fixing bugs**: `mastermind:debug` first (root cause) → write failing test via `mastermind:tdd` → fix → `mastermind:verify`
- **After building**: `mastermind:review` — at minimum one pass before reporting complete
- **Consuming a review**: `mastermind:receive-review` — verify before implementing, clarify unclear items first
- **After any run**: Brain Write Procedure — score decisions, append to AgentDB
- **Before releasing**: `mastermind:review --tillend --auto` → `mastermind:verify` → `mastermind:finish`
- **Isolated work**: `mastermind:worktree` before making changes to avoid contaminating main

### Platform Note

This command assumes **Claude Code** as the execution environment. The `Skill` tool is the primary mechanism for loading and invoking mastermind skills — never use the Read tool on skill files directly. Skill content is loaded and injected by the harness when you call `Skill("mastermind:name")`.

---

**If $ARGUMENTS is empty:** Output the capability menu below and wait.

---

**MASTERMIND** — autonomous business execution across specialist domains.

Describe your goal. Mastermind identifies the relevant domains, spawns specialist agents in parallel, and synthesizes results. Or invoke a domain directly.

---

**Debug & quality**
`/mastermind:debug` — systematic root-cause investigation before any fix attempt
`/mastermind:verify` — confirm claims with evidence: tests pass, feature works, fix resolved
`/mastermind:tdd` — enforce Red-Green-Refactor; no production code before failing test

**Plan & execute**
`/mastermind:design` — brainstorm, propose approaches, write approved spec before building
`/mastermind:plan` — write a complete implementation plan (no placeholders, exact file paths)
`/mastermind:execute` — run a written plan step-by-step with stop-on-blocker discipline
`/mastermind:taskdev` — execute a plan via fresh subagents with two-stage per-task review
`/mastermind:finish` — complete a branch: verify tests → options menu → merge/PR/keep/discard

**Build & ship**
`/mastermind:build` — code, features, bug fixes, test suites
`/mastermind:architect` — system structure, DDD, deduplication, migration (`--scope review|design|deduplicate|migrate|all`)
`/mastermind:idea` — products, features, pivots, opportunity framing
`/mastermind:content` — blog, threads, documentation, newsletters

**Review & improve**
`/mastermind:review` — code quality, content critique, strategy audit
`/mastermind:receive-review` — consume a code review correctly: verify, clarify, push back with evidence

**Understand & decide**
`/mastermind:research` — market intelligence, competitors, user insights
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

**Autonomous & advanced**
`/mastermind:autodev` — research → build → review loop until clean (`--tillend` supported)
`/mastermind:techport` — technical portfolio assessment; port capabilities from other projects
`/mastermind:worktree` — isolate work in a git worktree safely
`/mastermind:skill-builder` — write or improve a mastermind skill with TDD discipline

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

If `--project` was not provided, default `project_name` to the current directory name:
```bash
project_name="${project_name:-$(basename "$PWD")}"
```

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
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
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

**DOMAIN EXCEPTION — `idea`:** The `idea` domain MUST always be handled by the master invoking `Skill("mastermind:idea")` directly — NEVER by spawning a Task agent. Spawned agents do not have Skill tool access, so delegating `idea` to a Task agent silently degrades to raw analysis with no pipeline execution. After `mastermind:idea` returns, treat its output as the `idea` domain's unified output schema and proceed to the next domain.

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

**Board naming convention:** Every board is named `<project_name>-<domain>` (e.g. `factory-idea`, `factory-build`). This canonical name is stable across runs — mastermind finds the existing board instead of creating a new one every time.

```bash
# Compatible with macOS bash 3.2 — no associative arrays, uses jq accumulation instead
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"

# monotask availability guard — all card/board operations below require it
if ! command -v monotask >/dev/null 2>&1; then
  echo "WARN: monotask CLI not found — board and card creation will be skipped."
  echo "Install via: npm install -g monotask"
  echo "Domain managers will run without board IDs (text-only output)."
  # Write marker to current.json so Step 7 Phase C skips Task spawning with empty boards
  jq '. + {monotask_available: false}' "$SESSION_STATE" > "$SESSION_STATE.tmp" \
    && mv "$SESSION_STATE.tmp" "$SESSION_STATE" 2>/dev/null || true
  exit 0
fi

SESSION_ID=$(jq -r '.sessionId // empty' "$SESSION_STATE" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing in current.json — run Step 3 first"; exit 1; }
project_name=$(jq -r '.project_name // ""' "$SESSION_STATE")
[ -z "$project_name" ] && { echo "ERROR: project_name is empty in current.json — run Step 3 first"; exit 1; }
resolved_prompt=$(jq -r '.prompt // ""' "$SESSION_STATE")

# LLM: replace DOMAINS_LIST_HERE with space-separated domain names, e.g.: build marketing sales
domains_needed="DOMAINS_LIST_HERE"
[ "$domains_needed" = "DOMAINS_LIST_HERE" ] && { echo "ERROR: LLM did not substitute DOMAINS_LIST_HERE"; exit 1; }
[ -z "$domains_needed" ] && { echo "ERROR: domains_needed is empty — nothing to do"; exit 1; }

# Resolve space once — find existing by exact name or create
space_id=$(monotask space list 2>/dev/null | awk -F'|' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$project_name" | head -1)
[ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
[ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }
echo "Space: $space_id ($project_name)"

# jq accumulation state (replaces bash 4.3+ associative arrays)
state_patch='{}'

for domain in $domains_needed; do
  canonical="${project_name}-${domain}"

  # Find existing board by canonical name — reuse across runs
  # board list format is "uuid: name" (colon-space separator, NOT pipe)
  board_id=$(monotask board list 2>/dev/null | awk -F': ' '{gsub(/^ +| +$/,"",$1);gsub(/^ +| +$/,"",$2);if($2==n)print $1}' n="$canonical" | head -1)

  # Domain-specific column schema:
  #   idea    → New | Evaluated | Elaborated | Tasked | Iced | Rejected   (intake = "New")
  #   all others → Todo | In Progress | Human in Loop | Review | Done | Cancelled (intake = "Todo")
  if [ "$domain" = "idea" ]; then
    intake_col_name="New"
  else
    intake_col_name="Todo"
  fi

  if [ -n "$board_id" ]; then
    echo "Reusing board: $board_id ($canonical)"
    cols_json=$(monotask column list "$board_id" --json 2>/dev/null || echo '[]')
    todo_col=$(echo "$cols_json" | jq -r --arg n "$intake_col_name" '[.[] | select(.title==$n)] | .[0].id // empty')
    doing_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="In Progress" or .title=="Doing")] | .[0].id // empty')
    done_col=$(echo "$cols_json" | jq -r '[.[] | select(.title=="Done")] | .[0].id // empty')
  else
    echo "Creating board: $canonical"
    board_id=$(monotask board create --space "$space_id" "$canonical" --json 2>/dev/null | jq -r '.id // empty')
    [ -z "$board_id" ] && { echo "ERROR: Failed to create board '$canonical'"; exit 1; }
    monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
    if [ "$domain" = "idea" ]; then
      todo_col=$(monotask column create "$board_id" "New"        --json | jq -r '.id // empty')
      doing_col=$(monotask column create "$board_id" "Evaluated" --json | jq -r '.id // empty')
      monotask column create "$board_id" "Elaborated" --json >/dev/null
      monotask column create "$board_id" "Tasked"     --json >/dev/null
      monotask column create "$board_id" "Iced"       --json >/dev/null
      done_col=$(monotask column create "$board_id" "Rejected" --json | jq -r '.id // empty')
    else
      todo_col=$(monotask column create "$board_id" "Todo"           --json | jq -r '.id // empty')
      doing_col=$(monotask column create "$board_id" "In Progress"   --json | jq -r '.id // empty')
      monotask column create "$board_id" "Human in Loop" --json >/dev/null
      monotask column create "$board_id" "Review"        --json >/dev/null
      done_col=$(monotask column create "$board_id" "Done" --json | jq -r '.id // empty')
      monotask column create "$board_id" "Cancelled"     --json >/dev/null
    fi
    [ -z "$todo_col" ] && { echo "ERROR: Failed to create intake column for $domain"; exit 1; }
  fi

  domain_goal=$(jq -r --arg d "$domain" '.domain_goals[$d] // empty' "$SESSION_STATE")
  [ -z "$domain_goal" ] && domain_goal="$resolved_prompt"

  state_patch=$(echo "$state_patch" | jq \
    --arg d "$domain" --arg b "$board_id" \
    --arg t "$todo_col" --arg g "$doing_col" --arg e "$done_col" \
    --arg goal "$domain_goal" \
    '.board_ids[$d]=$b | .todo_cols[$d]=$t | .doing_cols[$d]=$g | .done_cols[$d]=$e | .domain_goals[$d]=$goal')

  echo "DOMAIN=$domain BOARD=$board_id TODO=$todo_col DOING=$doing_col DONE=$done_col"
done

# Persist to current.json — one atomic merge
jq --arg domains "$domains_needed" \
   --argjson patch "$state_patch" \
  '. + $patch + {domains_needed:($domains | split(" ") | map(select(length>0)))}' \
  "$SESSION_STATE" > "$SESSION_STATE.tmp" && mv "$SESSION_STATE.tmp" "$SESSION_STATE"
echo "Session state saved to current.json"
```

### Step 7 — Spawn Domain Managers

**BEFORE THIS STEP:** If `idea` is in `domains_needed`, invoke `Skill("mastermind:idea")` directly now (master context has Skill tool access). Pass the resolved prompt, project path, and mode. The idea skill's Step 7 writes its output to `.monomind/sessions/<SESSION_ID>/idea.json` automatically — do not write it again. Mark the `idea` domain as handled. Do NOT include `idea` in the Task spawning below.

**IDEA PIPELINE REQUIREMENT:** `mastermind:idea` runs a multi-step pipeline (Steps 3–6 inside idea.md). You MUST follow all of those steps — do NOT shortcut to manually creating cards. The full pipeline is:
- Step 3: Board setup — find-or-create `<project_name>-idea` board (master's Step 6 already created it with correct columns: New → Evaluated → Elaborated → Tasked → Iced → Rejected). Load column IDs from existing board.
- Step 4: Spawn Idea Manager agent (coordinator) with specialist sub-agents per angle — generates ideas as cards in the `New` column.
- Step 5: Spawn PM agent for validation — moves each card to `Evaluated`, `Iced`, or `Rejected`, sets impact/effort.
- Step 6a: Elaboration agents enrich each `Evaluated` card and move it to `Elaborated`.
- Step 6b: User gate (skip in auto mode).
- Step 6c: Task decomposition — creates subtask cards on `<project_name>-tasks-dev` and `<project_name>-tasks-ops` boards, linked as subtasks of their parent idea card. Moves parent idea cards to `Tasked`.

Skipping any of these steps produces an incomplete pipeline run — card content is generated but no evaluation, elaboration, or task breakdown occurs.

**Before spawning**, select the best domain manager agent type from the registry for each active domain. Do not hardcode `coordinator` — pick the agent whose expertise best fits the domain goal.

**BASH TOOL REQUIREMENT:** Domain managers must run `monotask` CLI commands. Only use subagent_types that include Bash in their tool list. If the registry returns an agent without Bash (e.g. `Product Manager`, `Backend Architect`), override it with `general-purpose` (which has all tools). Agents without Bash cannot create cards, emit curl events, or write session files — they will silently produce degraded output.

**Phase A — Registry selection** (run as one Bash call; must complete before Phase C):

```bash
# Compatible with macOS bash 3.2 — uses jq accumulation instead of declare -A
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
REGISTRY="$REPO_ROOT/.monomind/registry.json"

# Reload state from current.json — this is a new shell; no inherited variables
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
[ -f "$SESSION_STATE" ] || { echo "ERROR: current.json not found — run from Step 3"; exit 1; }
# If Step 6 skipped due to missing monotask, board_ids are empty — skip Task agent spawning
if [ "$(jq -r '.monotask_available // true' "$SESSION_STATE")" = "false" ]; then
  echo "INFO: monotask_available=false — domain managers will be spawned in text-only mode (no board IDs)"
  echo "      Install monotask (npm install -g monotask) and re-run to enable board tracking."
fi
domains_needed=$(jq -r '.domains_needed[]? // empty' "$SESSION_STATE" | grep -v '^idea$' | tr '\n' ' ')
[ -z "$domains_needed" ] && { echo "INFO: no non-idea domains to spawn as Task agents"; }  # idea-only runs are valid

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

# jq accumulation (replaces bash 4.3+ declare -A — compatible with macOS bash 3.2)
domain_managers_json='{}'
for domain in $domains_needed; do
  goal=$(jq -r --arg d "$domain" '.domain_goals[$d] // empty' "$SESSION_STATE")
  [ -z "$goal" ] && goal=$(jq -r '.prompt // ""' "$SESSION_STATE")
  manager=$(pick_domain_manager "$domain" "$goal")
  domain_managers_json=$(echo "$domain_managers_json" | jq --arg d "$domain" --arg m "$manager" '. + {($d): $m}')
  echo "Domain manager for $domain: $manager"
done

# Persist domain_managers so Phase C can reload them without stdout parsing
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
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
# Filter idea — it was already handled by Skill tool before Phase A, not dispatched as a Task agent
domains_needed=$(jq -r '.domains_needed[]? // empty' "$SESSION_STATE" | grep -v '^idea$' | tr '\n' ' ')
for domain in $domains_needed; do
  goal=$(jq -r --arg d "$domain" '.domain_goals[$d] // empty' "$SESSION_STATE")
  [ -z "$goal" ] && goal=$(jq -r '.prompt // ""' "$SESSION_STATE")
  curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
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
for domain in $(jq -r '.domains_needed[]? // empty' "$SESSION_STATE" | grep -v '^idea$'); do
  board_id=$(jq -r --arg d "$domain" '.board_ids[$d] // ""' "$SESSION_STATE")
  if [ -z "$board_id" ]; then
    echo "WARN: DOMAIN=$domain has no board_id — Step 6 may not have run or monotask is missing. Task agent will run without board tracking."
  fi
  echo "DOMAIN=$domain \
MANAGER=$(jq -r --arg d "$domain" '.domain_managers[$d] // "coordinator"' "$SESSION_STATE") \
BOARD=$board_id \
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
- Instruction to use `Skill("monomind:do")` to execute tasks (Task agents have Skill tool access — do NOT use slash command syntax)
- Instruction to spawn specialized agents using the domain-appropriate swarm topology
- Instruction to return the unified output schema when done

Example Task call for Development Manager. Substitute all **pre-known** `<…>` placeholders (project_name, SESSION_ID, board/col IDs, goals, manager name) before calling Task. Placeholders like `<status>`, `<path1>`, `<action1>` are filled at runtime by the spawned agent — do not attempt to substitute them. `subagent_type` is the **string value** of `$domain_manager_build` (e.g. `"Backend Architect"`), not a variable reference.

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
    "   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)\n" +
    "   CTRL_URL=$(jq -r '.url // \"http://localhost:4242\"' \"$REPO_ROOT/.monomind/control.json\" 2>/dev/null || echo \"http://localhost:4242\")\n" +
    "   curl -s -o /dev/null -X POST ${CTRL_URL}/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d \"$(jq -cn --arg sid '<SESSION_ID>' --arg agent '<slug>' --arg task '<title>' \\\n" +
    "       '{type:\"agent:spawn\",session:$sid,domain:\"build\",agent:$agent,task:$task,ts:(now*1000|floor)}')\" || true\n\n" +
    "4. If handing off artifacts to another domain, emit intercom via curl:\n" +
    "   curl -s -o /dev/null -X POST ${CTRL_URL}/api/mastermind/event \\\n" +
    "     -H 'Content-Type: application/json' \\\n" +
    "     -d \"$(jq -cn --arg sid '<SESSION_ID>' --arg to '<domain>' --arg msg '<summary>' \\\n" +
    "       '{type:\"intercom\",session:$sid,from:\"build\",to:$to,msg:$msg,ts:(now*1000|floor)}')\" || true\n\n" +
    "5. Execute tasks via Skill(\"monomind:do\") --board <board_build>  (use Skill tool — slash command syntax does not work inside a Task agent)\n" +
    "6. Collect all agent outputs\n\n" +
    "7. BEFORE returning, write your output schema to disk AND emit domain:complete:\n" +
    "   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)\n" +
    "   CTRL_URL=$(jq -r '.url // \"http://localhost:4242\"' \"$REPO_ROOT/.monomind/control.json\" 2>/dev/null || echo \"http://localhost:4242\")\n" +
    "   mkdir -p \"$REPO_ROOT/.monomind/sessions/<SESSION_ID>\"\n" +
    "   jq -n --arg domain 'build' --arg status '<status>' \\\n" +
    "     --argjson artifacts '[\"<path1>\",\"<path2>\"]' \\\n" +
    "     --argjson next_actions '[\"<action1>\"]' \\\n" +
    "     '{domain:$domain,status:$status,artifacts:$artifacts,next_actions:$next_actions}' \\\n" +
    "     > \"$REPO_ROOT/.monomind/sessions/<SESSION_ID>/build.json\"\n" +
    "   curl -s -o /dev/null -X POST ${CTRL_URL}/api/mastermind/event \\\n" +
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
# Compatible with macOS bash 3.2 — only uses indexed arrays
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SESSION_ID=$(jq -r '.sessionId // empty' "$REPO_ROOT/.monomind/sessions/current.json" 2>/dev/null)
[ -z "$SESSION_ID" ] && { echo "ERROR: SESSION_ID missing"; exit 1; }
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")

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

curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
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
# Compatible with macOS bash 3.2 — only uses indexed arrays
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
SESSION_STATE="$REPO_ROOT/.monomind/sessions/current.json"
# Echo to stdout — bash variables don't survive tool call boundaries; only stdout is visible to the LLM
# Emit run summary (artifacts, next_actions, project_name) from the session file
jq '{artifacts:.artifacts,next_actions:.next_actions,project_name:.project_name}' "$SESSION_FILE" 2>/dev/null \
  || echo '{"artifacts":[],"next_actions":[],"project_name":""}'

# Emit board_ids from current.json (not carried in SESSION_FILE) so Step 12c can look up board UUIDs
echo "--- board_ids (from current.json) ---"
jq '{board_ids:(.board_ids // {})}' "$SESSION_STATE" 2>/dev/null \
  || echo '{"board_ids":{}}'
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

Execute the chosen activity by invoking the appropriate domain skill via the `Skill` tool (Steps 4–10 of the main flow, condensed). Use `Skill("mastermind:<domain>")` — do NOT use slash command syntax (`/<name>`), which only works in the Claude Code CLI prompt and not inside a running skill:

- Test → `Skill("mastermind:build")` with a testing-focused prompt
- Debug/Fix → `Skill("mastermind:build")` with the specific failing test or error as prompt
- Review → `Skill("mastermind:review")` with scope = artifacts from last run
- Improve/Refactor → `Skill("mastermind:build")` with refactor prompt
- Add feature → `Skill("mastermind:build")` with the next feature from the `next_actions` array printed by the Step 12a output above
- Research → `Skill("mastermind:research")` with the open question as prompt
- Content/Docs → `Skill("mastermind:content")` with scope = new artifacts
- Release → `Skill("mastermind:release")` with project scope

Always pass: the current brain_context, project_name (from the `project_name` field above), the relevant board_id (look up `.board_ids[<chosen_domain>]` from the `board_ids` map printed above), and mode = auto (iteration cycles never pause for confirmation).

**Constraint:** Only invoke domains whose board_id already exists in the `board_ids` map. If the chosen activity maps to a domain not in `board_ids` (e.g. `release` was not activated in Step 6), choose the next highest-priority activity whose domain IS in `board_ids`, or invoke `build` as the safe fallback — its board is almost always present.

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
