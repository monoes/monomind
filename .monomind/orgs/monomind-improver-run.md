# monomind-improver — iteration run prompt
# This file is executed inline by runorg (step 1.6.4) AND used as the ScheduleWakeup prompt for subsequent cycles.

## Step 0 — Status Gate

```bash
ORG_FILE=".monomind/orgs/monomind-improver.json"
STATUS=$(jq -r '.status // "stopped"' "$ORG_FILE" 2>/dev/null || echo "stopped")
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
# Capture Claude project dir for token tracking (jsonl files created by Task agents)
CLAUDE_PROJECT_DIR="$HOME/.claude/projects/$(echo "$REPO_ROOT" | tr '/' '-' | sed 's/^-//')"
```

If `STATUS == "stopped"`: print "Org monomind-improver has been stopped — skipping iteration." and **STOP immediately**. Do not execute any further steps.

If `STATUS == "paused"`: print "Org monomind-improver is paused — skipping iteration." and **STOP immediately**.

If `STATUS == "active"`: continue to Step 1.

## Step 1 — Analyze & Prioritize

Before spawning the analyzer, snapshot the current Claude session files:
```bash
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

Wait for the analyzer to return. Then emit its token usage:
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
    -d "$(echo "$USAGE" | jq --arg org "monomind-improver" --arg role "analyzer" '. + {type:"agent:usage",org:$org,role:$role,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi
```

Select the top-ranked improvement that has not been done.

## Step 2 — Implement

Before spawning the coder, snapshot sessions:
```bash
JSONL_SNAP_2=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Spawn a coder agent (subagent_type: `coder`) with these instructions (fill in `<chosen_improvement>` and `<rationale>` from Step 1):

> You are the Implementation Engineer for the monomind-improver org.
>
> TASK: <chosen_improvement>
> RATIONALE: <rationale>
> PROJECT ROOT: /Users/morteza/Desktop/tools/monomind
>
> Rules:
> 1. Read every file you will modify BEFORE editing it.
> 2. Follow existing code patterns — do not introduce new abstractions unless necessary.
> 3. Do not touch unrelated files.
> 4. After implementation, list every changed file path and write a one-paragraph summary of what you changed and why.

Wait for the coder to return. Emit usage:
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
    -d "$(echo "$USAGE" | jq --arg org "monomind-improver" --arg role "coder" '. + {type:"agent:usage",org:$org,role:$role,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi
```

Capture the changed file list and summary.

## Step 3 — Review

Before spawning the reviewer, snapshot:
```bash
JSONL_SNAP_4=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Spawn a reviewer agent (subagent_type: `reviewer`) with these instructions:

> You are the Code Reviewer for the monomind-improver org.
>
> CHANGED FILES: <file list from Step 2>
> CHANGE SUMMARY: <summary from Step 2>
>
> Review each changed file for:
> - Logic errors or off-by-one bugs
> - Security issues (injection, path traversal, credential exposure)
> - Broken patterns or conventions from the existing codebase
> - Unintended side effects on other features
>
> If issues found: list them with specific file:line references and return `verdict: needs_fixes`.
> If approved: return `verdict: approved` with a suggested commit message (one line, imperative mood).

Wait for reviewer. Emit usage:
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
    -d "$(echo "$USAGE" | jq --arg org "monomind-improver" --arg role "reviewer" '. + {type:"agent:usage",org:$org,role:$role,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi
```

If reviewer returns `needs_fixes`: send the feedback back to the coder (Step 2) with the specific issues listed. Allow up to 2 fix cycles. If still blocked after 2 cycles, skip this improvement (log "skipped: reviewer blocked after 2 cycles" to foundation.md) and STOP this iteration.

## Step 4 — Commit

Before spawning git-manager, snapshot:
```bash
JSONL_SNAP_6=$(ls -t "$CLAUDE_PROJECT_DIR"/*.jsonl 2>/dev/null | head -20 | sort)
```

Once reviewer approves, spawn a git-manager agent (subagent_type: `coder`) with these instructions:

> You are the Git Commit Manager for the monomind-improver org.
>
> CHANGED FILES: <file list from Step 2>
> COMMIT MESSAGE: <suggested message from reviewer>
>
> Steps:
> 1. `git status` — confirm you are on branch improve/auto (or switch to it).
> 2. If not on improve/auto: `git checkout improve/auto 2>/dev/null || git checkout -b improve/auto`.
> 3. `git rebase origin/main 2>/dev/null || git rebase main` — stay current with main.
> 4. Stage ONLY the changed files: `git add <file1> <file2> ...` (use -f for dist/ files).
> 5. Commit: `git commit -m "<commit message>" -m "Co-Authored-By: nokhodian <nokhodian@gmail.com>"`.
> 6. Report the commit hash.

Wait for git-manager. Emit usage:
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
    -d "$(echo "$USAGE" | jq --arg org "monomind-improver" --arg role "git-manager" '. + {type:"agent:usage",org:$org,role:$role,ts:(now*1000|floor|tostring|tonumber)}')" || true
fi
```

## Step 5 — Log to Foundation

Append one line to `.monomind/orgs/monomind-improver/foundation.md`:

```bash
FOUNDATION=".monomind/orgs/monomind-improver/foundation.md"
DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo "- [${DATE}] <chosen_improvement> — <commit hash>" >> "$FOUNDATION"
```

Replace `<chosen_improvement>` with the actual improvement title and `<commit hash>` with the hash from Step 4.

## Step 6 — Report

Emit a summary event:

```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg org "monomind-improver" \
    --arg improvement "<chosen_improvement>" \
    --arg commit "<commit hash>" \
    '{type:"org:cycle:complete",org:$org,improvement:$improvement,commit:$commit,ts:(now*1000|floor)}')" || true
```

Print:
```
✓ monomind-improver cycle complete
  Improvement: <chosen_improvement>
  Commit: <commit hash>
  Next run: 60s
```
