---
name: _repeat
description: Shared inter-session repeat protocol. Referenced by mastermind and monomind commands via "Follow the Repeat Preamble/Postamble from _repeat.md".
---

## Shared Repeat Protocol

Adds `--repeat <N> --wait <seconds>` inter-session looping to any command. Uses `ScheduleWakeup` to pause between runs and `.monomind/loops/<id>.json` for dashboard tracking.

---

## REPEAT PREAMBLE

Apply immediately after flag extraction, before any other command logic.

### 1. Extract repeat flags

Extract and remove these flags from `$ARGUMENTS` before passing the remainder to the command's own parser:

| Flag | Variable | Default | Notes |
|---|---|---|---|
| `--repeat <N>` | `repeat_count` | `0` | N ≥ 2 activates repeat; N < 2 = disabled |
| `--wait <seconds>` | `wait_seconds` | `60` | Minimum 60 (enforced by ScheduleWakeup) |
| `--rep <N>` | `current_rep` | absent | Internal; injected by ScheduleWakeup on continuation runs |
| `--loop <id>` | `loop_id` | absent | Internal; preserves loop identity across runs |

### 2. If `--rep N` is present (continuation run)

- Set `current_rep` = N, `loop_id` from `--loop <id>`
- Set `is_continuation = true`
- The calling command MUST skip its empty-prompt check and intake when `is_continuation = true`

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
- Output: `[repeat] Loop paused before run <current_rep>/<repeat_count>: waiting for human responses in ${HIL_FILE}.`
- Update state file:
  ```bash
  python3 -c "import json; f='.monomind/loops/${LOOP_ID}.json'; d=json.load(open(f)); d['status']='hil:pending'; open(f,'w').write(json.dumps(d,indent=2))" 2>/dev/null \
    || jq '.status="hil:pending"' ".monomind/loops/${LOOP_ID}.json" > ".monomind/loops/${LOOP_ID}.json.tmp" && mv ".monomind/loops/${LOOP_ID}.json.tmp" ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || true
  ```
- Emit `loop:hil:waiting`:
  ```bash
  curl -s -X POST "http://localhost:4242/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:hil:waiting\",\"loopId\":\"${LOOP_ID}\",\"hilFile\":\"${HIL_FILE}\",\"rep\":<current_rep>,\"ts\":$(date +%s)000}" || true
  ```
- Re-schedule a check (not a full run) using ScheduleWakeup:
  - `delaySeconds`: `min(wait_seconds, 300)` — check at most every 5 minutes
  - `prompt`: same full continuation prompt (same `--rep <N>`)
  - `reason`: `"HIL pending for /<command> run <current_rep>/<repeat_count> — re-checking"`
- STOP. Do not execute the command yet.

**If `LOOP_HIL_ANSWERED=true` (human responded):**
- Output: `[repeat] Human response received. Archiving HIL file and resuming.`
- Archive: `mv "$HIL_FILE" ".monomind/loops/${LOOP_ID}-hil-resolved-$(date +%s).md"`
- Emit `loop:hil:resolved`:
  ```bash
  curl -s -X POST "http://localhost:4242/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:hil:resolved\",\"loopId\":\"${LOOP_ID}\",\"rep\":<current_rep>,\"ts\":$(date +%s)000}" || true
  ```
- Update state file:
  ```bash
  python3 -c "import json; f='.monomind/loops/${LOOP_ID}.json'; d=json.load(open(f)); d['status']='running'; open(f,'w').write(json.dumps(d,indent=2))" 2>/dev/null \
    || jq '.status="running"' ".monomind/loops/${LOOP_ID}.json" > ".monomind/loops/${LOOP_ID}.json.tmp" && mv ".monomind/loops/${LOOP_ID}.json.tmp" ".monomind/loops/${LOOP_ID}.json" 2>/dev/null || true
  ```
- Proceed to execute the command (output: `[repeat] Run <current_rep>/<repeat_count> of /<command> starting...`)

**If no HIL file:** Output: `[repeat] Run <current_rep>/<repeat_count> of /<command> starting...` and proceed to the command's core logic.

### 3. If `--rep` is absent and `repeat_count ≥ 2` (first run)

1. Generate loop ID and write state file:
   ```bash
   mkdir -p .monomind/loops
   # Portable millisecond timestamp (BSD date has no %N; GNU date has %3N)
   NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
   LOOP_ID="<command_slug>-${NOW_MS}"
   # Dashboard expects interval in MINUTES (rounded), maxReps as the total run count
   INTERVAL_MIN=$(( (<wait_seconds> + 30) / 60 ))
   PROMPT_JSON=$(printf '%s' "<prompt>" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
     || printf '%s' "<prompt>" | node -e "process.stdout.write(JSON.stringify(require('fs').readFileSync('/dev/stdin','utf8')))" 2>/dev/null \
     || printf '"%s"' "$(printf '%s' "<prompt>" | sed 's/\\/\\\\/g; s/"/\\"/g; s/$/\\n/g' | tr -d '\n' | sed 's/\\n$//')")
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
   curl -s -X POST "http://localhost:4242/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "{\"type\":\"loop:start\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"repeat\":<repeat_count>,\"wait\":<wait_seconds>,\"ts\":$(date +%s)000}" || true
   ```

3. Set `current_rep` = 1, `is_continuation` = false
4. Output: `[repeat] Starting <repeat_count> runs of /<command> (<wait_seconds>s between each). Run 1/<repeat_count>...`

### 4. If `repeat_count < 2`

No repeat behavior. Proceed normally. The REPEAT POSTAMBLE is a no-op.

---

## REPEAT POSTAMBLE

Apply after the command's core logic fully completes (after skill returns, after final step, etc.).

**If `repeat_count < 2`:** skip this section entirely.

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

Output: `[repeat] Run <current_rep>/<repeat_count> complete.`

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
   cat > "$HIL_FILE" << EOF
   # Human-in-Loop — /<command> run <current_rep>/<repeat_count>
   Loop: ${LOOP_ID}
   Created: $(date -u +"%Y-%m-%d %H:%M UTC")
   Status: pending

   The following files contain items requiring human decisions before the loop continues:

   $(echo "$RECENT_HIL" | while IFS= read -r f; do [ -n "$f" ] && echo "- \`$f\`"; done)

   ## Instructions

   1. Open each file listed above and fill in **Your response** for each item.
   2. Any non-empty response after a `> ` line is treated as "answered".
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
   curl -s -X POST "http://localhost:4242/api/mastermind/event" \
     -H "Content-Type: application/json" \
     -d "{\"type\":\"loop:hil\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"hilFile\":\"${HIL_FILE}\",\"rep\":<current_rep>,\"files\":$(echo "$RECENT_HIL" | grep -v '^$' | jq -R . | jq -cs .),\"ts\":$(date +%s)000}" || true
   ```

4. Output:
   ```
   [repeat] Human-in-loop items detected from run <current_rep>/<repeat_count>.
   Action required: open the files listed in ${HIL_FILE} and fill in responses.
   ```

5. Compute `next_rep = current_rep + 1`. Then branch on whether this was the last run:

   **If `current_rep >= repeat_count`** (HIL detected on the final run — do not schedule another execution):
   - Output: `[repeat] All <repeat_count> runs of /<command> complete (HIL items pending in ${HIL_FILE}).`
   - Emit `loop:complete`:
     ```bash
     curl -s -X POST "http://localhost:4242/api/mastermind/event" \
       -H "Content-Type: application/json" \
       -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"ranReps\":<repeat_count>,\"hilPending\":true,\"ts\":$(date +%s)000}" || true
     ```
   - `rm -f ".monomind/loops/${LOOP_ID}.json"`
   - STOP. (HIL file remains for human review; loop is done.)

   **Otherwise** (HIL on an intermediate run — schedule a poll check):
   - Output: `Loop will resume automatically at run <next_rep>/<repeat_count> once responses are provided.`
   - `delaySeconds`: `min(wait_seconds, 300)` — re-check every 5 min max while waiting
   - `prompt`: `/<command> --repeat <repeat_count> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <original flags and prompt>`
   - `reason`: `"HIL pending for /<command> run <current_rep>/<repeat_count> — waiting for human response"`
   - Schedule via `ScheduleWakeup` and STOP. Do not proceed to "Schedule next run" below.

**If `RECENT_HIL` is empty:** proceed to step 4 (schedule next run normally).

### 4. If all runs done (`current_rep ≥ repeat_count`)

- Output: `[repeat] All <repeat_count> runs of /<command> complete.`
- `rm -f ".monomind/loops/${LOOP_ID}.json"`
- Emit `loop:complete`:
  ```bash
  curl -s -X POST "http://localhost:4242/api/mastermind/event" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"loop:complete\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"ranReps\":<repeat_count>,\"ts\":$(date +%s)000}" || true
  ```
- STOP (do not schedule another run).

### 5. Schedule next run

Set `next_rep` = current_rep + 1.

Update state file (read `prompt` and `startedAt` from the existing file to preserve them):
```bash
# Portable millisecond timestamp (BSD date has no %N; GNU date has %3N)
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
NEXT_AT=$(( NOW_MS + <wait_seconds> * 1000 ))
INTERVAL_MIN=$(( (<wait_seconds> + 30) / 60 ))
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
  "type": "repeat",
  "command": "/<command>",
  "prompt": ${PROMPT_JSON},
  "maxReps": <repeat_count>,
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
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:tick\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/<command>\",\"completedRep\":<current_rep>,\"nextRep\":<next_rep>,\"nextAt\":${NEXT_AT},\"ts\":$(date +%s)000}" || true
```

Output: `[repeat] Next run in <wait_seconds>s (run <next_rep>/<repeat_count>)...`

Call `ScheduleWakeup`:
- `delaySeconds`: `<wait_seconds>` (runtime clamps to minimum 60)
- `prompt`: `/<command> --repeat <repeat_count> --wait <wait_seconds> --rep <next_rep> --loop ${LOOP_ID} <all original flags and prompt text, minus --rep and --loop>`
- `reason`: `"repeat run <next_rep>/<repeat_count> of /<command>"`

---

## Notes for Calling Commands

- **`<command_slug>`**: lowercase command name without namespace (`build` for `/mastermind:build`, `monomind-idea` for `/monomind:idea`)
- **Dashboard**: the monomind panel reads `.monomind/loops/*.json` to show active repeat loops; HIL status shows as `"hil:pending"` in the status field
- **Stopping a loop**: create `.monomind/loops/${LOOP_ID}.stop` or delete the `.json` file; the next wake-up detects it
- **`wait_seconds` < 60**: ScheduleWakeup clamps to 60; the state file may reflect the user's requested value
- **Continuation runs skip intake**: calling commands check `is_continuation` and bypass empty-prompt checks and vague-prompt intake
- **HIL file naming**: commands write `humaninloop*.md` or `humaninloopreview*.md`; the repeat protocol detects these automatically via `find` — no changes needed in individual commands
- **HIL resume**: the human fills in any `> ` answer line in the HIL files; the next check detects this via `grep -cE "^[[:space:]]*>[[:space:]]+[^[:space:]]"` and resumes the loop
- **HIL check interval**: while HIL is pending, ScheduleWakeup fires every `min(wait_seconds, 300)` seconds to poll; this is transparent to the user
