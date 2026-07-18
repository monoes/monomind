---
name: mastermind-repeat-postamble
description: REPEAT POSTAMBLE — executes inter-session repeat/tillend loop continuation after any mastermind or monomind command completes. Calls ScheduleWakeup when work remains.
type: protocol-skill
---

# REPEAT POSTAMBLE

<EXTREMELY-IMPORTANT>
## MANDATORY EXECUTION — READ THIS FIRST

This postamble is **not optional**. You MUST execute every step below. You MUST call ScheduleWakeup unless a legitimate stop condition is met (stop file, empty round confirmed by git, or count reached).

**Anti-rationalization rules:**
- "I think the work is done" is NOT a reason to stop. Only the checks below decide.
- "The skill already handled everything" is NOT a reason to skip this postamble.
- "There's nothing more to do" is NOT your decision — the tillend check decides.
- For `--repeat N`: you MUST run all N iterations. The count is non-negotiable. You cannot stop at run 3 of 5 because you think 3 was enough.
- For `--tillend`: you MUST continue until git AND your assessment BOTH confirm an empty round. Your feeling that "it's probably clean" is not evidence.

If you are about to end your response without calling ScheduleWakeup and you have not hit a legitimate stop condition, **YOU ARE MAKING AN ERROR. Go back and call ScheduleWakeup.**
</EXTREMELY-IMPORTANT>

**If neither `tillend_mode = true` nor `repeat_count ≥ 2` was active in this invocation, stop immediately — this skill is a no-op.**

Otherwise execute all steps below before ending the response.

---

## Step 1 — Stop check

```bash
[ -f ".monomind/loops/${LOOP_ID}.stop" ] && echo "STOP_REQUESTED"
```

If the stop file exists:
- Output: `[repeat] Stop requested. Halting after run <current_rep>.`
- Run: `rm -f ".monomind/loops/${LOOP_ID}.json" ".monomind/loops/${LOOP_ID}.stop"`
- **END** (do not continue to Step 2).

---

## Step 2 — Tillend termination check (tillend mode only — skip for fixed-count)

**`LOOP_ASYNC_PENDING` escape hatch:** If the calling skill set `LOOP_ASYNC_PENDING=true` before invoking this postamble (because it spawned background agents whose results have not yet arrived), skip the empty-round check and go directly to Step 4 to schedule the next run. Output: `[tillend] Async work in flight — deferring empty-round check to run <next_rep>.`

**Step 2a — Machine verification (REQUIRED before any self-assessment):**

Run this command to get an objective signal of whether files changed during this run:

```bash
GIT_CHANGES=$(git diff --stat HEAD 2>/dev/null; git diff --cached --stat 2>/dev/null; git status --porcelain 2>/dev/null | grep -v '^\?\?' | head -20)
echo "GIT_CHANGES_DURING_RUN: ${GIT_CHANGES:-NONE}"
```

If `GIT_CHANGES` is non-empty, files were modified — `TILLEND_EMPTY=false` regardless of your self-assessment. Skip to "Otherwise" below.

**Step 2b — Self-assessment (only if git shows no changes):**

Only if `GIT_CHANGES` was empty, evaluate whether this run produced findings (issues identified, problems flagged) or actions (tasks created, content written, configs changed — anything not captured by git diff).

Set `TILLEND_EMPTY=true` **only if git shows no changes AND your self-assessment confirms zero findings and zero actions**.

**Important**: If this round found things AND fixed them, `TILLEND_EMPTY=false` — the loop must continue to verify the fixes didn't introduce new issues.

**If `TILLEND_EMPTY=true`:**
- Output:
  ```
  [tillend] Empty round — nothing found, nothing changed in run <current_rep>.
  /<command> tillend loop complete (ran <current_rep> run(s)).
  ```
- Emit dashboard event (non-fatal if control server is not running):
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"mode\":\"tillend\",\"ranReps\":<current_rep>,\"reason\":\"empty-round\",\"project\":\"${REPO_ROOT}\",\"ts\":$(date +%s)000}" || true
  ```
- Run: `rm -f ".monomind/loops/${LOOP_ID}.json"`
- **END**.

**If `current_rep >= tillend_maxruns` (safety cap reached):**
- Output:
  ```
  [tillend] Safety cap reached (<tillend_maxruns> runs). Stopping loop.
  If work is still incomplete, re-run: /<command> --tillend --maxruns <N> <prompt>
  ```
- Run: `rm -f ".monomind/loops/${LOOP_ID}.json"`
- **END**.

**Otherwise (`TILLEND_EMPTY=false`, cap not reached):**
- Output: `[tillend] Run <current_rep> produced findings or actions. Scheduling run <next_rep>...`
- Continue to Step 4.

---

## Step 3 — Fixed-count completion check (fixed-count mode only — skip for tillend)

If `current_rep >= repeat_count`:
- Output: `[repeat] All <repeat_count> runs of /<command> complete.`
- Emit dashboard event:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"ranReps\":<repeat_count>,\"project\":\"${REPO_ROOT}\",\"ts\":$(date +%s)000}" || true
  ```
- Run: `rm -f ".monomind/loops/${LOOP_ID}.json"`
- **END**.

---

## Step 4 — Schedule next run (REQUIRED tool call — cannot be skipped)

Compute `next_rep = current_rep + 1`.

Update state file:
```bash
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
NEXT_AT=$(( NOW_MS + <wait_seconds> * 1000 ))
INTERVAL_MIN=$(( (<wait_seconds> + 30) / 60 ))
LOOP_TYPE=$( [ "<tillend_mode>" = "true" ] && echo "tillend" || echo "repeat" )
MAX_REPS=$( [ "<tillend_mode>" = "true" ] && echo "<tillend_maxruns>" || echo "<repeat_count>" )
PROMPT_JSON=$(jq '.prompt' ".monomind/loops/${LOOP_ID}.json" 2>/dev/null \
  || python3 -c "import json; print(json.dumps(json.load(open('.monomind/loops/${LOOP_ID}.json'))['prompt']))" 2>/dev/null \
  || echo '"<prompt>"')
STARTED_AT=$(jq '.startedAt' ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || echo "${NOW_MS}")
cat > ".monomind/loops/${LOOP_ID}.json" << EOF
{
  "id": "${LOOP_ID}",
  "sessionId": "${LOOP_ID}",
  "type": "${LOOP_TYPE}",
  "command": "/<command>",
  "prompt": ${PROMPT_JSON},
  "maxReps": ${MAX_REPS},
  "interval": ${INTERVAL_MIN},
  "wait": <wait_seconds>,
  "currentRep": <next_rep>,
  "startedAt": ${STARTED_AT},
  "lastRunAt": ${NOW_MS},
  "nextRunAt": ${NEXT_AT},
  "status": "running",
  "source": "_repeat.md"
}
EOF
```

Emit `loop:tick`:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:tick\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"completedRep\":<current_rep>,\"nextRep\":<next_rep>,\"nextAt\":${NEXT_AT},\"project\":\"${REPO_ROOT}\",\"ts\":$(date +%s)000}" || true
```

**Call `ScheduleWakeup` now** — this is a mandatory tool call:

- **Tillend mode**:
  - `delaySeconds`: `<wait_seconds>`
  - `prompt`: `/<command> --tillend --maxruns <tillend_maxruns> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <original_prompt_text>`
  - `reason`: `"tillend run <next_rep> of /<command> (cap: <tillend_maxruns>)"`
  - Output before calling: `[tillend] Work remains. Next run in <wait_seconds>s (run <next_rep>, cap: <tillend_maxruns>)...`

- **Fixed-count mode**:
  - `delaySeconds`: `<wait_seconds>`
  - `prompt`: `/<command> --repeat <repeat_count> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <original_prompt_text>`
  - `reason`: `"repeat run <next_rep>/<repeat_count> of /<command>"`
  - Output before calling: `[repeat] Next run in <wait_seconds>s (run <next_rep>/<repeat_count>)...`
