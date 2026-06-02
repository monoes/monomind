---
name: _repeat
description: Shared inter-session repeat protocol. Referenced by mastermind and monomind commands via "Follow the Repeat Preamble/Postamble from _repeat.md".
---

## Shared Repeat Protocol

Adds `--repeat <N> --wait <seconds>` and `--tillend --wait <seconds>` inter-session looping to any command. Uses `ScheduleWakeup` to pause between runs and `.monomind/loops/<id>.json` for dashboard tracking.

---

## REPEAT PREAMBLE

Apply immediately after flag extraction, before any other command logic.

### 1. Extract repeat flags

Extract and remove these flags from `$ARGUMENTS` before passing the remainder to the command's own parser:

| Flag | Variable | Default | Notes |
|---|---|---|---|
| `--repeat <N>` | `repeat_count` | `0` | N ≥ 2 activates repeat; N < 2 = disabled |
| `--tillend` | `tillend_mode` | `false` | Run until empty round (no findings, no actions). Overrides --repeat. |
| `--maxruns <N>` | `tillend_maxruns` | `50` | Safety cap for --tillend; stops after N runs even if AI hasn't signaled done |
| `--wait <seconds>` | `wait_seconds` | `60` | Minimum 60 (enforced by ScheduleWakeup) |
| `--rep <N>` | `current_rep` | absent | Internal; injected by ScheduleWakeup on continuation runs |
| `--loop <id>` | `loop_id` | absent | Internal; preserves loop identity across runs |

If both `--tillend` and `--repeat <N>` are present, `--tillend` takes precedence.

### 2. If `--rep N` is present (continuation run)

- Set `current_rep` = N, `loop_id` from `--loop <id>`
- Set `is_continuation = true`
- The calling command MUST skip its empty-prompt check and intake when `is_continuation = true`

**First — staleness guard (run before anything else):**

Check whether the loop file exists and whether this wakeup is stale:

```bash
LOOP_FILE=".monomind/loops/${LOOP_ID}.json"
if [ ! -f "$LOOP_FILE" ]; then
  echo "[repeat] Stale wakeup: loop ${LOOP_ID} is already complete (state file gone). Skipping."
  # STOP — do not execute the command
else
  LOOP_CURRENT_REP=$(python3 -c "import json; print(json.load(open('${LOOP_FILE}'))['currentRep'])" 2>/dev/null \
    || jq -r '.currentRep // 0' "${LOOP_FILE}" 2>/dev/null || echo "0")
  if [ "${current_rep}" -lt "${LOOP_CURRENT_REP}" ]; then
    echo "[repeat] Stale wakeup: got --rep ${current_rep} but loop is already at rep ${LOOP_CURRENT_REP}. Skipping."
    # STOP — do not execute the command
  fi
fi
```

If the stale guard fires (either branch): **STOP immediately. Do not proceed to HIL check or command execution.**

**Before proceeding, check for a pending HIL file:**
```bash
HIL_FILE=".monomind/loops/${LOOP_ID}-hil.md"
LOOP_HIL_PENDING=false
LOOP_HIL_ANSWERED=false
if [ -f "$HIL_FILE" ]; then
  RESPONSES=$(grep -cE "^[[:space:]]*>[[:space:]]+[^[:space:]]" "$HIL_FILE" 2>/dev/null)
  RESPONSES=${RESPONSES:-0}
  if [ "$RESPONSES" -eq 0 ]; then
    LOOP_HIL_PENDING=true
  else
    LOOP_HIL_ANSWERED=true
  fi
fi
```

**If `LOOP_HIL_PENDING=true` (HIL file exists but unanswered):**
- Output (tillend mode): `[tillend] Loop paused before run <current_rep>: waiting for human responses in ${HIL_FILE}.`
- Output (fixed-count mode): `[repeat] Loop paused before run <current_rep>/<repeat_count>: waiting for human responses in ${HIL_FILE}.`
- Update state file:
  ```bash
  python3 -c "import json; f='.monomind/loops/${LOOP_ID}.json'; d=json.load(open(f)); d['status']='hil:pending'; open(f,'w').write(json.dumps(d,indent=2))" 2>/dev/null \
    || jq '.status="hil:pending"' ".monomind/loops/${LOOP_ID}.json" > ".monomind/loops/${LOOP_ID}.json.tmp" && mv ".monomind/loops/${LOOP_ID}.json.tmp" ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || true
  ```
- Emit `loop:hil:waiting`:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:hil:waiting\",\"loopId\":\"${LOOP_ID}\",\"hilFile\":\"${HIL_FILE}\",\"rep\":<current_rep>,\"ts\":$(date +%s)000}" || true
  ```
- Re-schedule a check (not a full run) using ScheduleWakeup:
  - `delaySeconds`: `min(wait_seconds, 300)` — check at most every 5 minutes
  - `prompt`: same full continuation prompt (same `--rep <N>`)
  - `reason`: tillend mode: `"HIL pending for /<command> tillend run <current_rep> — re-checking"` / fixed-count: `"HIL pending for /<command> run <current_rep>/<repeat_count> — re-checking"`
- STOP. Do not execute the command yet.

**If `LOOP_HIL_ANSWERED=true` (human responded):**
- Output: `[repeat] Human response received. Archiving HIL file and resuming.`
- Archive: `mv "$HIL_FILE" ".monomind/loops/${LOOP_ID}-hil-resolved-$(date +%s).md"`
- Emit `loop:hil:resolved`:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:hil:resolved\",\"loopId\":\"${LOOP_ID}\",\"rep\":<current_rep>,\"ts\":$(date +%s)000}" || true
  ```
- Update state file:
  ```bash
  python3 -c "import json; f='.monomind/loops/${LOOP_ID}.json'; d=json.load(open(f)); d['status']='running'; open(f,'w').write(json.dumps(d,indent=2))" 2>/dev/null \
    || jq '.status="running"' ".monomind/loops/${LOOP_ID}.json" > ".monomind/loops/${LOOP_ID}.json.tmp" && mv ".monomind/loops/${LOOP_ID}.json.tmp" ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || true
  ```
- Proceed to execute the command:
  - Tillend mode: `[tillend] Run <current_rep> of /<command> starting...`
  - Fixed-count: `[repeat] Run <current_rep>/<repeat_count> of /<command> starting...`

**If no HIL file:**
- Tillend mode: `[tillend] Run <current_rep> of /<command> starting...`
- Fixed-count: `[repeat] Run <current_rep>/<repeat_count> of /<command> starting...`

Proceed to the command's core logic.

### 3. If `--rep` is absent — first run

**Branch A: `tillend_mode = true`** OR **Branch B: `repeat_count ≥ 2`**

If neither condition is true, skip to Section 4.

1. Generate loop ID and write state file:
   ```bash
   mkdir -p .monomind/loops
   # Portable millisecond timestamp (BSD date has no %N; GNU date has %3N)
   NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
   LOOP_ID="<command_slug>-${NOW_MS}"
   # Dashboard expects interval in MINUTES (rounded)
   INTERVAL_MIN=$(( (<wait_seconds> + 30) / 60 ))
   PROMPT_JSON=$(printf '%s' "<prompt>" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
     || printf '%s' "<prompt>" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))" 2>/dev/null \
     || printf '"%s"' "$(printf '%s' "<prompt>" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n' | sed 's/\\n$//')")
   ```

   **If `tillend_mode = true`:**
   ```bash
   cat > ".monomind/loops/${LOOP_ID}.json" << EOF
   {
     "id": "${LOOP_ID}",
     "sessionId": "${LOOP_ID}",
     "type": "tillend",
     "command": "/<command>",
     "prompt": ${PROMPT_JSON},
     "maxReps": <tillend_maxruns>,
     "interval": ${INTERVAL_MIN},
     "wait": <wait_seconds>,
     "currentRep": 1,
     "startedAt": ${NOW_MS},
     "lastRunAt": ${NOW_MS},
     "nextRunAt": ${NOW_MS},
     "status": "running",
     "source": "_repeat.md"
   }
   EOF
   ```

   **If `repeat_count ≥ 2` (fixed-count mode):**
   ```bash
   cat > ".monomind/loops/${LOOP_ID}.json" << EOF
   {
     "id": "${LOOP_ID}",
     "sessionId": "${LOOP_ID}",
     "type": "repeat",
     "command": "/<command>",
     "prompt": ${PROMPT_JSON},
     "maxReps": <repeat_count>,
     "interval": ${INTERVAL_MIN},
     "wait": <wait_seconds>,
     "currentRep": 1,
     "startedAt": ${NOW_MS},
     "lastRunAt": ${NOW_MS},
     "nextRunAt": ${NOW_MS},
     "status": "running",
     "source": "_repeat.md"
   }
   EOF
   ```

2. Emit `loop:start` to dashboard (failure is non-fatal):
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   # For tillend mode, repeat field is the safety cap
   REPEAT_VAL=$( [ "<tillend_mode>" = "true" ] && echo "<tillend_maxruns>(cap)" || echo "<repeat_count>" )
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "{\"type\":\"loop:start\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"mode\":\"$( [ '<tillend_mode>' = 'true' ] && echo 'tillend' || echo 'repeat' )\",\"repeat\":\"${REPEAT_VAL}\",\"wait\":<wait_seconds>,\"ts\":$(date +%s)000}" || true
   ```

3. Set `current_rep` = 1, `is_continuation` = false
4. Output:
   - **tillend mode**: `[tillend] Starting tillend loop for /<command> (runs until empty round, safety cap: <tillend_maxruns>, <wait_seconds>s between runs). Run 1...`
   - **fixed-count mode**: `[repeat] Starting <repeat_count> runs of /<command> (<wait_seconds>s between each). Run 1/<repeat_count>...`

### 4. If neither `tillend_mode` nor `repeat_count ≥ 2`

No repeat behavior. Proceed normally. The REPEAT POSTAMBLE is a no-op.

---

## REPEAT POSTAMBLE

Apply after the command's core logic fully completes (after skill returns, after final step, etc.).

**If neither `tillend_mode` nor `repeat_count ≥ 2`:** skip this section entirely.

**Otherwise:**

### 1. Check for stop request

```bash
[ -f ".monomind/loops/${LOOP_ID}.stop" ] && REPEAT_STOP=true
```

If `REPEAT_STOP=true`:
- Output: `[repeat] Stop requested. Halting after run <current_rep>/<repeat_count>.`
- `rm -f ".monomind/loops/${LOOP_ID}.json" ".monomind/loops/${LOOP_ID}.stop"`
- STOP.

### 2. Report this run complete

Output:
- Tillend mode: `[tillend] Run <current_rep> complete.`
- Fixed-count: `[repeat] Run <current_rep>/<repeat_count> complete.`

### 3. Detect HIL items from this run

Check for files written since this run started that signal human decisions are needed:

```bash
# Collect any humaninloop*.md files created or modified in the last 600 seconds
RECENT_HIL=$(find . -maxdepth 3 \( -name "humaninloop*.md" -o -name "humaninloopreview*.md" \) \
  -newer ".monomind/loops/${LOOP_ID}.json" 2>/dev/null | head -10)
```

**If `RECENT_HIL` is non-empty (HIL items were written by this run):**

1. Write a loop HIL file aggregating all items:
   ```bash
   HIL_FILE=".monomind/loops/${LOOP_ID}-hil.md"
   # Use run label appropriate to mode
   RUN_LABEL=$( [ "<tillend_mode>" = "true" ] && echo "run <current_rep> (tillend)" || echo "run <current_rep>/<repeat_count>" )
   cat > "$HIL_FILE" << EOF
   # Human-in-Loop — /<command> ${RUN_LABEL}
   Loop: ${LOOP_ID}
   Created: $(date -u +"%Y-%m-%d %H:%M UTC")
   Status: pending

   The following files contain items requiring human decisions before the loop continues:

   $(echo "$RECENT_HIL" | while IFS= read -r f; do [ -n "$f" ] && echo "- \`$f\`"; done)

   ## Instructions

   1. Open each file listed above and fill in **Your response** for each item.
   2. Any non-empty response after a \`> \` line is treated as "answered".
   3. Once you have filled in at least one response, the loop will auto-resume on the next check.

   **Your answer (fill in to resume):**
   > 
   EOF
   ```

2. Update state file:
   ```bash
   python3 -c "import json; f='.monomind/loops/${LOOP_ID}.json'; d=json.load(open(f)); d['status']='hil:pending'; open(f,'w').write(json.dumps(d,indent=2))" 2>/dev/null \
     || jq '.status="hil:pending"' ".monomind/loops/${LOOP_ID}.json" > ".monomind/loops/${LOOP_ID}.json.tmp" && mv ".monomind/loops/${LOOP_ID}.json.tmp" ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || true
   ```

3. Emit `loop:hil` to dashboard:
   ```bash
   REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "{\"type\":\"loop:hil\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"hilFile\":\"${HIL_FILE}\",\"rep\":<current_rep>,\"files\":$(echo "$RECENT_HIL" | grep -v '^$' | jq -R . | jq -cs .),\"ts\":$(date +%s)000}" || true
   ```

4. Output:
   ```
   [repeat] Human-in-loop items detected from run <current_rep>.
   Action required: open the files listed in ${HIL_FILE} and fill in responses.
   ```

5. Compute `next_rep = current_rep + 1`. Build the HIL poll continuation prompt:

   **If `tillend_mode = true`:**
   - HIL continuation prompt: `/<command> --tillend --maxruns <tillend_maxruns> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <original prompt>`
   - Output: `Loop will resume automatically once responses are provided.`
   - `delaySeconds`: `min(wait_seconds, 300)`
   - `reason`: `"HIL pending for /<command> tillend run <current_rep> — waiting for human response"`
   - Schedule via `ScheduleWakeup` and STOP.

   **If `current_rep >= repeat_count`** (HIL detected on the final fixed-count run):
   - Output: `[repeat] All <repeat_count> runs of /<command> complete (HIL items pending in ${HIL_FILE}).`
   - Emit `loop:complete`:
     ```bash
     REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
     CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
     curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
       -H "Content-Type: application/json" \
       -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"ranReps\":<repeat_count>,\"hilPending\":true,\"ts\":$(date +%s)000}" || true
     ```
   - `rm -f ".monomind/loops/${LOOP_ID}.json"`
   - STOP. (HIL file remains for human review; loop is done.)

   **Otherwise** (HIL on an intermediate fixed-count run):
   - Output: `Loop will resume automatically at run <next_rep>/<repeat_count> once responses are provided.`
   - `delaySeconds`: `min(wait_seconds, 300)`
   - `prompt`: `/<command> --repeat <repeat_count> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <original flags and prompt>`
   - `reason`: `"HIL pending for /<command> run <current_rep>/<repeat_count> — waiting for human response"`
   - Schedule via `ScheduleWakeup` and STOP.

**If `RECENT_HIL` is empty:** proceed to section 4.

---

### 4. Tillend completion check (tillend mode only)

**Skip this section if `tillend_mode` is not true.** Proceed to section 5.

After each run in tillend mode, evaluate whether this run produced **zero findings and zero actions**. The loop stops only when a complete round finds nothing new and makes no changes — not when the AI predicts there is nothing left.

**You (the AI running the loop) must now assess your own output from this run.** Answer these two questions:

1. **Were any findings produced?** — issues found, problems detected, items identified, things flagged, errors reported, tasks discovered, security vulnerabilities found, etc.
2. **Were any actions taken?** — files edited, code fixed, tasks created, cards moved, commits made, content written, configs changed, etc.

**Set `TILLEND_EMPTY=true` only if BOTH answers are "no" — zero findings AND zero actions this round.**

**Important:** If this round found things AND fixed them all, `TILLEND_EMPTY=false`. The loop must run once more to verify the fixes didn't introduce new issues. A "clean" prediction after a productive round is not enough — only an actually empty round stops the loop.

**If `TILLEND_EMPTY=true` (round produced nothing):**
- Output:
  ```
  [tillend] Empty round — nothing found, nothing changed in run <current_rep>.
  /<command> tillend loop complete (ran <current_rep> run(s)).
  ```
- Emit `loop:complete`:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"mode\":\"tillend\",\"ranReps\":<current_rep>,\"reason\":\"empty-round\",\"ts\":$(date +%s)000}" || true
  ```
- `rm -f ".monomind/loops/${LOOP_ID}.json"`
- STOP.

**If `current_rep >= tillend_maxruns` (safety cap reached):**
- Output:
  ```
  [tillend] Safety cap reached (<tillend_maxruns> runs). Stopping loop.
  If work is still incomplete, re-run: /<command> --tillend --maxruns <N> --wait <wait_seconds> <prompt>
  ```
- Emit `loop:complete`:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"mode\":\"tillend\",\"ranReps\":<current_rep>,\"reason\":\"safety-cap\",\"ts\":$(date +%s)000}" || true
  ```
- `rm -f ".monomind/loops/${LOOP_ID}.json"`
- STOP.

**Otherwise (`TILLEND_EMPTY=false` and cap not reached):**
- Output: `[tillend] Run <current_rep> produced work (findings or actions). Continuing...`
- Proceed to section 5 to schedule the next run.

---

### 5. Fixed-count: check if all runs done (`current_rep ≥ repeat_count`)

**Skip this section if `tillend_mode = true`** (tillend has no fixed count; section 4 handles its termination).

- Output: `[repeat] All <repeat_count> runs of /<command> complete.`
- `rm -f ".monomind/loops/${LOOP_ID}.json"`
- Emit `loop:complete`:
  ```bash
  REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
  CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
  curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"ranReps\":<repeat_count>,\"ts\":$(date +%s)000}" || true
  ```
- STOP (do not schedule another run).

### 6. Schedule next run

Set `next_rep` = current_rep + 1.

Update state file (read `prompt` and `startedAt` from the existing file to preserve them):
```bash
# Portable millisecond timestamp (BSD date has no %N; GNU date has %3N)
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
NEXT_AT=$(( NOW_MS + <wait_seconds> * 1000 ))
INTERVAL_MIN=$(( (<wait_seconds> + 30) / 60 ))
LOOP_TYPE=$( [ "<tillend_mode>" = "true" ] && echo "tillend" || echo "repeat" )
MAX_REPS=$( [ "<tillend_mode>" = "true" ] && echo "<tillend_maxruns>" || echo "<repeat_count>" )
PROMPT_JSON=$(jq '.prompt' ".monomind/loops/${LOOP_ID}.json" 2>/dev/null \
  || python3 -c "import json,sys; json.dump(json.load(open('.monomind/loops/${LOOP_ID}.json'))['prompt'], sys.stdout)" 2>/dev/null \
  || echo '"<prompt>"')
STARTED_AT=$(jq '.startedAt' ".monomind/loops/${LOOP_ID}.json" 2>/dev/null \
  || python3 -c "import json; print(json.load(open('.monomind/loops/${LOOP_ID}.json'))['startedAt'])" 2>/dev/null \
  || echo "${NOW_MS}")
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
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:tick\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"mode\":\"${LOOP_TYPE}\",\"completedRep\":<current_rep>,\"nextRep\":<next_rep>,\"nextAt\":${NEXT_AT},\"ts\":$(date +%s)000}" || true
```

**Output and ScheduleWakeup:**

**If `tillend_mode = true`:**
- Output: `[tillend] Work remains. Next run in <wait_seconds>s (run <next_rep>, cap: <tillend_maxruns>)...`
- `ScheduleWakeup`:
  - `delaySeconds`: `<wait_seconds>`
  - `prompt`: `/<command> --tillend --maxruns <tillend_maxruns> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <all original flags and prompt text, minus --rep and --loop>`
  - `reason`: `"tillend run <next_rep> of /<command> (cap: <tillend_maxruns>)"`

**If fixed-count mode:**
- Output: `[repeat] Next run in <wait_seconds>s (run <next_rep>/<repeat_count>)...`
- `ScheduleWakeup`:
  - `delaySeconds`: `<wait_seconds>`
  - `prompt`: `/<command> --repeat <repeat_count> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <all original flags and prompt text, minus --rep and --loop>`
  - `reason`: `"repeat run <next_rep>/<repeat_count> of /<command>"`

---

## Notes for Calling Commands

- **`<command_slug>`**: lowercase command name without namespace (`build` for `/mastermind:build`, `mastermind-idea` for `/mastermind:idea`)
- **Dashboard**: the monomind panel reads `.monomind/loops/*.json`; `type` field is `"repeat"` or `"tillend"`; HIL status shows as `"hil:pending"`
- **Stopping a loop**: create `.monomind/loops/${LOOP_ID}.stop` or delete the `.json` file; the next wake-up detects it
- **`wait_seconds` < 60**: ScheduleWakeup clamps to 60; the state file may reflect the user's requested value
- **Continuation runs skip intake**: calling commands check `is_continuation` and bypass empty-prompt checks and vague-prompt intake
- **HIL file naming**: commands write `humaninloop*.md` or `humaninloopreview*.md`; the repeat protocol detects these automatically via `find` — no changes needed in individual commands
- **HIL resume**: the human fills in any `> ` answer line in the HIL files; the next check detects this via `grep -cE "^[[:space:]]*>[[:space:]]+[^[:space:]]"` and resumes the loop
- **HIL check interval**: while HIL is pending, ScheduleWakeup fires every `min(wait_seconds, 300)` seconds to poll; this is transparent to the user
- **`--tillend` termination**: the loop stops only when a complete round produces ZERO findings AND ZERO actions. If the round found+fixed things, it continues — even if the AI predicts "all done". Only a genuinely empty verification round stops the loop. `reason: "empty-round"` in the `loop:complete` event.
- **`--tillend` safety cap**: default 50 runs. Override with `--maxruns <N>`. Always emit a warning when stopping on cap so user knows to re-run if needed
- **Combining flags**: `--tillend` overrides `--repeat N` if both are present. `--maxruns` only applies to `--tillend`
