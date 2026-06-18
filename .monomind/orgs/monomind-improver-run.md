# monomind-improver — iteration run prompt
# This file is executed inline by runorg (step 1.6.4) AND used as the ScheduleWakeup prompt for subsequent cycles.

## Step 0 — Status Gate & Run Init

```bash
ORG_FILE=".monomind/orgs/monomind-improver.json"
STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
# Capture Claude project dir for token tracking
CLAUDE_PROJECT_DIR="$HOME/.claude/projects/$(echo "$REPO_ROOT" | tr '/' '-' | sed 's/^-//')"
# Generate unique run ID for this cycle
RUN_ID="run-$(date -u +%Y%m%dT%H%M%S)"

# Comm helper — emits org:comms event so Chat tab captures agent communications
_comm() {
  local _from="$1" _to="$2" _msg="$3"
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn \
      --arg org "monomind-improver" \
      --arg runId "$RUN_ID" \
      --arg from "$_from" \
      --arg to "$_to" \
      --arg msg "$_msg" \
      '{type:"org:comms",org:$org,runId:$runId,from:$from,to:$to,msg:$msg,ts:(now*1000|floor)}')" || true
}
```

If `STATUS == "stopped"`: print "Org monomind-improver has been stopped — skipping iteration." and **STOP immediately**. Do not execute any further steps.

If `STATUS == "paused"`: print "Org monomind-improver is paused — skipping iteration." and **STOP immediately**.

If `STATUS == "active"`: emit the run start event and continue to Step 1:

```bash
# Register this run with the server — creates the run file and enables Chat tab
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg org "monomind-improver" \
    --arg runId "$RUN_ID" \
    '{type:"run:start",org:$org,runId:$runId,goal:"Analyze codebase, implement highest-value improvement, commit to improve/auto",ts:(now*1000|floor)}')" || true
```

## Step 1 — Analyze & Prioritize

```bash
_comm "boss" "analyzer" "Starting cycle ${RUN_ID}. Please analyze the codebase and return the top-ranked improvement not yet done in foundation.md."
JSONL_SNAP_0=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Spawn an analyzer agent (subagent_type: `researcher`) with these instructions:

> You are the Codebase Analyzer for the monomind-improver org.
>
> 1. Read `.monomind/orgs/monomind-improver/foundation.md` to see what improvements have already been made — do NOT suggest the same thing twice.
> 2. Run `git log --oneline -20 origin/main 2>/dev/null || git log --oneline -20` to see recent trajectory.
> 3. Identify the top 5 improvement candidates across: bugs, UX issues, CLI performance, missing features, tech debt.
> 4. Rank them by (estimated impact) ÷ (estimated effort). Exclude already-done items from foundation.md.
> 5. Return the ranked list with a one-paragraph rationale for each, and a one-line "chosen improvement" at the top.

Wait for the analyzer to return. Then emit token usage and the analyzer's report:
```bash
JSONL_SNAP_1=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
NEW_JSONL=$(comm -13 <(echo "$JSONL_SNAP_0") <(echo "$JSONL_SNAP_1") | head -1)
if [ -n "$NEW_JSONL" ] && [ -f "$NEW_JSONL" ]; then
  USAGE=$(python3 -c "
import json, sys
tin=tout=0
for l in open(sys.argv[1]):
  try:
    d=json.loads(l)
    u=d.get('message',{}).get('usage',{})
    tin+=u.get('input_tokens',0); tout+=u.get('output_tokens',0)
  except: pass
cost=tin*3e-6+tout*15e-6
print(json.dumps({'tokens_in':tin,'tokens_out':tout,'cost_usd':round(cost,6)}))
" "$NEW_JSONL" 2>/dev/null || echo '{"tokens_in":0,"tokens_out":0,"cost_usd":0}')
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(echo "$USAGE" | jq \
      --arg org "monomind-improver" \
      --arg role "analyzer" \
      --arg runId "$RUN_ID" \
      '. + {type:"agent:usage",org:$org,role:$role,runId:$runId,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi
```

Select the top-ranked improvement that has not been done. Set `CHOSEN_IMPROVEMENT` and `CHOSEN_RATIONALE` from the analyzer's output.

```bash
# After reading analyzer output — emit the report back to boss
_comm "analyzer" "boss" "Top improvement: ${CHOSEN_IMPROVEMENT}. Rationale: ${CHOSEN_RATIONALE}"
```

## Step 2 — Implement

```bash
_comm "boss" "coder" "Task: ${CHOSEN_IMPROVEMENT}. ${CHOSEN_RATIONALE} Please implement and return changed files + summary."
JSONL_SNAP_2=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Spawn a coder agent (subagent_type: `coder`) with these instructions (fill in `CHOSEN_IMPROVEMENT` and `CHOSEN_RATIONALE` from Step 1):

> You are the Implementation Engineer for the monomind-improver org.
>
> TASK: <CHOSEN_IMPROVEMENT>
> RATIONALE: <CHOSEN_RATIONALE>
> PROJECT ROOT: /Users/morteza/Desktop/tools/monomind
>
> Rules:
> 1. Read every file you will modify BEFORE editing it.
> 2. Follow existing code patterns — do not introduce new abstractions unless necessary.
> 3. Do not touch unrelated files.
> 4. After implementation, list every changed file path and write a one-paragraph summary of what you changed and why.

Wait for the coder to return. Set `CHANGED_FILES` and `CHANGE_SUMMARY` from coder's output. Emit usage and report:
```bash
JSONL_SNAP_3=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
NEW_JSONL=$(comm -13 <(echo "$JSONL_SNAP_2") <(echo "$JSONL_SNAP_3") | head -1)
if [ -n "$NEW_JSONL" ] && [ -f "$NEW_JSONL" ]; then
  USAGE=$(python3 -c "
import json, sys
tin=tout=0
for l in open(sys.argv[1]):
  try:
    d=json.loads(l)
    u=d.get('message',{}).get('usage',{})
    tin+=u.get('input_tokens',0); tout+=u.get('output_tokens',0)
  except: pass
cost=tin*3e-6+tout*15e-6
print(json.dumps({'tokens_in':tin,'tokens_out':tout,'cost_usd':round(cost,6)}))
" "$NEW_JSONL" 2>/dev/null || echo '{"tokens_in":0,"tokens_out":0,"cost_usd":0}')
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(echo "$USAGE" | jq \
      --arg org "monomind-improver" \
      --arg role "coder" \
      --arg runId "$RUN_ID" \
      '. + {type:"agent:usage",org:$org,role:$role,runId:$runId,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi

_comm "coder" "reviewer" "Implementation complete. Changed: ${CHANGED_FILES}. Summary: ${CHANGE_SUMMARY}"
```

## Step 3 — Review

```bash
JSONL_SNAP_4=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Spawn a reviewer agent (subagent_type: `reviewer`) with these instructions:

> You are the Code Reviewer for the monomind-improver org.
>
> CHANGED FILES: <CHANGED_FILES from Step 2>
> CHANGE SUMMARY: <CHANGE_SUMMARY from Step 2>
>
> Review each changed file for:
> - Logic errors or off-by-one bugs
> - Security issues (injection, path traversal, credential exposure)
> - Broken patterns or conventions from the existing codebase
> - Unintended side effects on other features
>
> If issues found: list them with specific file:line references and return `verdict: needs_fixes`.
> If approved: return `verdict: approved` with a suggested commit message (one line, imperative mood).

Wait for reviewer. Set `REVIEWER_VERDICT` and `COMMIT_MSG` from reviewer's output. Emit usage and verdict:
```bash
JSONL_SNAP_5=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
NEW_JSONL=$(comm -13 <(echo "$JSONL_SNAP_4") <(echo "$JSONL_SNAP_5") | head -1)
if [ -n "$NEW_JSONL" ] && [ -f "$NEW_JSONL" ]; then
  USAGE=$(python3 -c "
import json, sys
tin=tout=0
for l in open(sys.argv[1]):
  try:
    d=json.loads(l)
    u=d.get('message',{}).get('usage',{})
    tin+=u.get('input_tokens',0); tout+=u.get('output_tokens',0)
  except: pass
cost=tin*3e-6+tout*15e-6
print(json.dumps({'tokens_in':tin,'tokens_out':tout,'cost_usd':round(cost,6)}))
" "$NEW_JSONL" 2>/dev/null || echo '{"tokens_in":0,"tokens_out":0,"cost_usd":0}')
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(echo "$USAGE" | jq \
      --arg org "monomind-improver" \
      --arg role "reviewer" \
      --arg runId "$RUN_ID" \
      '. + {type:"agent:usage",org:$org,role:$role,runId:$runId,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi

_comm "reviewer" "boss" "Verdict: ${REVIEWER_VERDICT}. Commit message: ${COMMIT_MSG}"
```

If reviewer returns `needs_fixes`: send the feedback back to the coder (Step 2) with specific issues listed. Emit a comms event before re-dispatching:
```bash
_comm "boss" "coder" "Reviewer flagged issues: ${REVIEWER_VERDICT}. Please fix and re-submit."
```
Allow up to 2 fix cycles. If still blocked after 2 cycles:
```bash
_comm "boss" "sys" "Skipping improvement after 2 failed review cycles: ${CHOSEN_IMPROVEMENT}"
```
Log "skipped: reviewer blocked after 2 cycles" to foundation.md and STOP this iteration.

## Step 4 — Commit

```bash
_comm "boss" "git-manager" "Review approved. Please commit: ${COMMIT_MSG}. Files: ${CHANGED_FILES}"
JSONL_SNAP_6=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Once reviewer approves, spawn a git-manager agent (subagent_type: `coder`) with these instructions:

> You are the Git Commit Manager for the monomind-improver org.
>
> CHANGED FILES: <CHANGED_FILES from Step 2>
> COMMIT MESSAGE: <COMMIT_MSG from Step 3>
>
> Steps:
> 1. `git status` — confirm you are on branch improve/auto (or switch to it).
> 2. If not on improve/auto: `git checkout improve/auto 2>/dev/null || git checkout -b improve/auto`.
> 3. `git rebase origin/main 2>/dev/null || git rebase main` — stay current with main.
> 4. Stage ONLY the changed files: `git add <file1> <file2> ...` (use -f for dist/ files).
> 5. Commit: `git commit -m "<COMMIT_MSG>" -m "Co-Authored-By: nokhodian <nokhodian@gmail.com>"`.
> 6. Report the commit hash.

Wait for git-manager. Set `COMMIT_HASH` from the reported hash. Emit usage and result:
```bash
JSONL_SNAP_7=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
NEW_JSONL=$(comm -13 <(echo "$JSONL_SNAP_6") <(echo "$JSONL_SNAP_7") | head -1)
if [ -n "$NEW_JSONL" ] && [ -f "$NEW_JSONL" ]; then
  USAGE=$(python3 -c "
import json, sys
tin=tout=0
for l in open(sys.argv[1]):
  try:
    d=json.loads(l)
    u=d.get('message',{}).get('usage',{})
    tin+=u.get('input_tokens',0); tout+=u.get('output_tokens',0)
  except: pass
cost=tin*3e-6+tout*15e-6
print(json.dumps({'tokens_in':tin,'tokens_out':tout,'cost_usd':round(cost,6)}))
" "$NEW_JSONL" 2>/dev/null || echo '{"tokens_in":0,"tokens_out":0,"cost_usd":0}')
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "$(echo "$USAGE" | jq \
      --arg org "monomind-improver" \
      --arg role "git-manager" \
      --arg runId "$RUN_ID" \
      '. + {type:"agent:usage",org:$org,role:$role,runId:$runId,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi

_comm "git-manager" "boss" "Committed: ${COMMIT_HASH} — ${COMMIT_MSG}"
```

## Step 5 — Log to Foundation

```bash
FOUNDATION=".monomind/orgs/monomind-improver/foundation.md"
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "- [${DATE}] ${CHOSEN_IMPROVEMENT} — ${COMMIT_HASH}" >> "$FOUNDATION"
```

## Step 6 — Report

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg org "monomind-improver" \
    --arg runId "$RUN_ID" \
    --arg improvement "$CHOSEN_IMPROVEMENT" \
    --arg commit "$COMMIT_HASH" \
    '{type:"org:cycle:complete",org:$org,runId:$runId,improvement:$improvement,commit:$commit,ts:(now*1000|floor)}')" || true

_comm "boss" "sys" "Cycle complete. Improvement: ${CHOSEN_IMPROVEMENT}. Commit: ${COMMIT_HASH}."
```

Print:
```
✓ monomind-improver cycle complete
  Run:         <RUN_ID>
  Improvement: <CHOSEN_IMPROVEMENT>
  Commit:      <COMMIT_HASH>
  Next run:    60s
```
