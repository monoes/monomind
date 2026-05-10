---
name: monomind:repeat
description: "Monomind — Repeat any prompt or slash command on a schedule — default 15 min interval, 10 repetitions. This is the universal loop wrapper for all commands."
---

## Argument Parsing

Parse `$ARGUMENTS` for the following flags. **Everything after the first `--` (double dash) is the prompt — no further flag parsing, even if subsequent `--` tokens appear.** If no `--` is present, extract known flags in any order and treat the remainder as the prompt:

- `--every <minutes>` — interval between repetitions in minutes (default: `15`). Minimum 1.
- `--times <count>` — total number of repetitions (default: `10`)
- `--rep <N>` — (internal continuation flag injected by ScheduleWakeup; do not expose to user). Must be a positive integer ≤ MAX_REPS+1; reject otherwise.
- `--loop <id>` — (internal continuation flag; preserves loop identity across runs). Must match format `repeat-[digits]-[digits]-[digits]`; reject otherwise.
- `--` — end of flags; everything after this is the prompt verbatim
- Everything else (after flag extraction) is the **prompt** to repeat

If `INTERVAL` is less than 1, set it to 1 and output: `[monomind:repeat] Interval clamped to 1 minute (minimum).`

If `MAX_REPS` is less than 1, set it to 1 and output: `[monomind:repeat] Repetitions clamped to 1 (minimum).`

If `MAX_REPS` is greater than 1000, set it to 1000 and output: `[monomind:repeat] Repetitions clamped to 1000 (maximum).`

If `--every` is present but its value is missing or not a number, use the default (15).

If `--loop` is present but does not match the pattern `repeat-<digits>-<digits>-<digits>`, output `[monomind:repeat] ERROR: invalid loop ID` and STOP.

**Examples:**
```
/monomind:repeat --every 5 --times 9 /mastermind:architect --iterate 2 review this project
/monomind:repeat --every 1 --times 20 /mastermind:review check for security issues
/monomind:repeat --every 30 /monomind:do --space abc --board def
/monomind:repeat check deployment status
```

If `$ARGUMENTS` is empty or contains only flags with no prompt, output this and STOP:
> **Usage:** `/monomind:repeat [--every <minutes>] [--times <count>] <prompt>`
>
> Defaults: every 15 minutes, 10 times.
>
> This is the universal loop wrapper. Wrap any slash command to repeat it:
> - `/monomind:repeat --every 5 --times 9 /mastermind:architect review this project`
> - `/monomind:repeat --every 1 --times 20 /mastermind:review check for security issues`
> - `/monomind:repeat --every 30 /monomind:do --space abc --board def`
> - `/monomind:repeat check deployment status`

---

## Internal Flag: `--rep` and `--loop`

When `--rep <N>` is present in arguments, this is a continuation from a previous wake-up:
- `INTERVAL`, `MAX_REPS`, and `PROMPT` are already set by argument parsing above (they arrive via the ScheduleWakeup prompt)
- Set `CURRENT_REP` to `N` instead of `1`
- Set `LOOP_ID` from `--loop <id>`
- Skip Step 1 initialization entirely
- Go directly to Step 2 (execute) with output:
  ```
  [monomind:repeat] Run N/MAX_REPS starting...
  ```

---

## Step 1: Initialize

Extract:
- `INTERVAL` — from `--every` flag, default `15` (minutes), minimum 1
- `MAX_REPS` — from `--times` flag, default `10`
- `PROMPT` — everything remaining after flags are removed
- `CURRENT_REP` — starts at `1`

Write the initial loop state file so the dashboard can track this run. **You MUST run this bash block now via the Bash tool.** Before running, substitute `<INTERVAL>` and `<MAX_REPS>` with the parsed integer values. For `<PROMPT>`, substitute the raw prompt text inside the heredoc below — the single-quoted delimiter (`'MONOMIND_PROMPT_7x9k2m'`) prevents all bash expansion, and python3 handles JSON encoding. **If the prompt text contains the literal string `MONOMIND_PROMPT_7x9k2m`, replace that string in the prompt with `MONOMIND_PROMPT` before substitution** (this prevents heredoc delimiter collision):

```bash
mkdir -p .monomind/loops
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
LOOP_ID="repeat-${NOW_MS}-${RANDOM}-$$"
PROMPT_JSON=$(python3 -c "import sys,json; sys.stdout.write(json.dumps(sys.stdin.read().rstrip(chr(10))))" << 'MONOMIND_PROMPT_7x9k2m'
<PROMPT>
MONOMIND_PROMPT_7x9k2m
)
if [ -z "$PROMPT_JSON" ]; then PROMPT_JSON='"(prompt unavailable)"'; fi
cat > ".monomind/loops/${LOOP_ID}.json" << EOF
{
  "id": "${LOOP_ID}",
  "sessionId": "${LOOP_ID}",
  "type": "repeat",
  "command": "/monomind:repeat",
  "prompt": ${PROMPT_JSON},
  "interval": <INTERVAL>,
  "currentRep": 1,
  "maxReps": <MAX_REPS>,
  "startedAt": ${NOW_MS},
  "lastRunAt": ${NOW_MS},
  "nextRunAt": ${NOW_MS},
  "status": "running"
}
EOF
echo "LOOP_ID=${LOOP_ID}"
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:start\",\"loopId\":\"${LOOP_ID}\",\"command\":\"/monomind:repeat\",\"maxReps\":<MAX_REPS>,\"interval\":<INTERVAL>,\"ts\":$(date +%s)000}" || true
```

Capture the `LOOP_ID` value echoed by the script — you will need it for all subsequent bash blocks.

Output:
```
[monomind:repeat] Starting: "<PROMPT>"
  Interval: every INTERVAL minutes
  Repetitions: MAX_REPS total
  Run 1/MAX_REPS starting now...
```

---

## Step 2: Execute the Prompt

Run the `PROMPT` as if the user typed it directly. This means:
- If the prompt starts with `/`, invoke it as a slash command via the Skill tool
- Otherwise, treat it as a normal user message and respond accordingly

---

## Step 3: Report and Schedule Next

**IMPORTANT:** In every bash block below, `<LOOP_ID>` must be substituted with the literal LOOP_ID value you captured from Step 1 (or from `--loop` on continuation runs). Shell variables do NOT persist between bash blocks.

Before scheduling the next run, check if a stop was requested:
```bash
[ -f ".monomind/loops/<LOOP_ID>.stop" ] && echo "STOP_REQUESTED=true" || echo "STOP_REQUESTED=false"
```
If `STOP_REQUESTED=true`, output `[monomind:repeat] Stop requested via dashboard. Halting.` and remove the state files:
```bash
rm -f ".monomind/loops/<LOOP_ID>.json" ".monomind/loops/<LOOP_ID>.stop"
```
Then STOP.

After execution completes, save the current rep as `PREV_REP`, then increment `CURRENT_REP`. Output:
```
[monomind:repeat] Run PREV_REP/MAX_REPS complete.
```

If `CURRENT_REP > MAX_REPS` (all runs done), output:
```
[monomind:repeat] All MAX_REPS repetitions complete.
```
Remove the state file and emit loop:complete:
```bash
rm -f ".monomind/loops/<LOOP_ID>.json" ".monomind/loops/<LOOP_ID>.stop"
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:complete\",\"loopId\":\"<LOOP_ID>\",\"command\":\"/monomind:repeat\",\"ranReps\":<MAX_REPS>,\"ts\":$(date +%s)000}" || true
```
STOP. Do NOT schedule another wake-up.

Otherwise, update the loop state before scheduling. **Run this bash block** (substitute `<LOOP_ID>`, `<INTERVAL>`, `<CURRENT_REP>`, `<MAX_REPS>`, and `<PREV_REP>` with their literal values):
```bash
NOW_MS=$(python3 -c 'import time;print(int(time.time()*1000))' 2>/dev/null || echo "$(date +%s)000")
NEXT_AT=$(( NOW_MS + <INTERVAL> * 60 * 1000 ))
PROMPT_JSON=$(jq '.prompt' ".monomind/loops/<LOOP_ID>.json" 2>/dev/null \
  || python3 -c "import json,sys; json.dump(json.load(open('.monomind/loops/<LOOP_ID>.json'))['prompt'], sys.stdout)" 2>/dev/null \
  || echo '"(prompt unavailable)"')
STARTED_AT=$(jq '.startedAt' ".monomind/loops/<LOOP_ID>.json" 2>/dev/null \
  || python3 -c "import json; print(json.load(open('.monomind/loops/<LOOP_ID>.json'))['startedAt'])" 2>/dev/null \
  || echo "${NOW_MS}")
cat > ".monomind/loops/<LOOP_ID>.json" << EOF
{
  "id": "<LOOP_ID>",
  "sessionId": "<LOOP_ID>",
  "type": "repeat",
  "command": "/monomind:repeat",
  "prompt": ${PROMPT_JSON},
  "interval": <INTERVAL>,
  "currentRep": <CURRENT_REP>,
  "maxReps": <MAX_REPS>,
  "startedAt": ${STARTED_AT},
  "lastRunAt": ${NOW_MS},
  "nextRunAt": ${NEXT_AT},
  "status": "running"
}
EOF
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"loop:tick\",\"loopId\":\"<LOOP_ID>\",\"command\":\"/monomind:repeat\",\"completedRep\":<PREV_REP>,\"nextRep\":<CURRENT_REP>,\"nextAt\":${NEXT_AT},\"ts\":$(date +%s)000}" || true
```

Output: `[monomind:repeat] Next run in INTERVAL minutes (run CURRENT_REP/MAX_REPS)...`

Use `ScheduleWakeup` with:
- `delaySeconds`: `INTERVAL * 60`
- `prompt`: `/monomind:repeat --every <INTERVAL> --times <MAX_REPS> --rep <CURRENT_REP> --loop <LOOP_ID> -- <PROMPT>`
- `reason`: `"repeat run <CURRENT_REP>/<MAX_REPS> of /monomind:repeat"`

The `--` before `<PROMPT>` ensures the prompt text is never parsed as flags, even if it contains `--every` or `--times`. Substitute all angle-bracket values with their literals.

---

## Interruption

The user can stop the loop at any time by:
- Interrupting the session (the next scheduled wake-up simply won't fire)
- Creating `.monomind/loops/<LOOP_ID>.stop` (or clicking Stop in the dashboard)
