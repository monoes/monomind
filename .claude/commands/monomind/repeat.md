---
name: monomind:repeat
description: "Monomind — Repeat a prompt on a schedule — default 15 min interval, 10 repetitions"
---

## Argument Parsing

Parse `$ARGUMENTS` for the following (in any order):

- `--every <minutes>` — interval between repetitions in minutes (default: `15`)
- `--times <count>` — total number of repetitions (default: `10`)
- Everything else is the **prompt** to repeat

**Examples:**
```
/monomind:repeat --every 5 --times 20 check if the build is passing
/monomind:repeat --every 30 run /monomind:do
/monomind:repeat check deployment status
```

If `$ARGUMENTS` is empty or contains only flags with no prompt, output this and STOP:
> **Usage:** `/monomind:repeat [--every <minutes>] [--times <count>] <prompt>`
>
> Defaults: every 15 minutes, 10 times.
>
> Examples:
> - `/monomind:repeat check deployment status`
> - `/monomind:repeat --every 5 --times 20 run tests and report`
> - `/monomind:repeat --every 30 /monomind:do --space abc --board def`

---

## Step 1: Initialize

Extract:
- `INTERVAL` — from `--every` flag, default `15` (minutes)
- `MAX_REPS` — from `--times` flag, default `10`
- `PROMPT` — everything remaining after flags are removed
- `CURRENT_REP` — starts at `1`
- `LOOP_ID` — generate as `repeat-<unix-timestamp-ms>` (use `date +%s000`)

Write the initial loop state file so the dashboard can track this run:
```bash
mkdir -p .monomind/loops
LOOP_ID="repeat-$(date +%s%3N)"
cat > ".monomind/loops/${LOOP_ID}.json" << EOF
{
  "id": "${LOOP_ID}",
  "type": "repeat",
  "prompt": "PROMPT",
  "interval": INTERVAL,
  "currentRep": 1,
  "maxReps": MAX_REPS,
  "startedAt": $(date +%s%3N),
  "lastRunAt": $(date +%s%3N),
  "nextRunAt": $(date +%s%3N),
  "status": "running"
}
EOF
```

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

Before scheduling the next run, check if a stop was requested:
```bash
[ -f ".monomind/loops/${LOOP_ID}.stop" ] && echo "STOP_REQUESTED=true"
```
If `STOP_REQUESTED=true`, output `[monomind:repeat] Stop requested via dashboard. Halting.` and remove the state files:
```bash
rm -f ".monomind/loops/${LOOP_ID}.json" ".monomind/loops/${LOOP_ID}.stop"
```
Then STOP.

After execution completes, output:
```
[monomind:repeat] Run CURRENT_REP/MAX_REPS complete. Next in INTERVAL minutes...
```

Increment `CURRENT_REP`.

If `CURRENT_REP > MAX_REPS`, output:
```
[monomind:repeat] All MAX_REPS repetitions complete.
```
Remove the state file:
```bash
rm -f ".monomind/loops/${LOOP_ID}.json"
```
STOP. Do NOT schedule another wake-up.

Otherwise, update the loop state before scheduling:
```bash
NEXT_AT=$(( $(date +%s%3N) + INTERVAL * 60 * 1000 ))
cat > ".monomind/loops/${LOOP_ID}.json" << EOF
{
  "id": "${LOOP_ID}",
  "type": "repeat",
  "prompt": "PROMPT",
  "interval": INTERVAL,
  "currentRep": CURRENT_REP,
  "maxReps": MAX_REPS,
  "startedAt": STARTED_AT,
  "lastRunAt": $(date +%s%3N),
  "nextRunAt": ${NEXT_AT},
  "status": "running"
}
EOF
```

Use `ScheduleWakeup` with:
- `delaySeconds`: `INTERVAL * 60`
- `prompt`: `/monomind:repeat --every INTERVAL --times MAX_REPS --rep CURRENT_REP PROMPT`
- `reason`: `"repeat run CURRENT_REP/MAX_REPS of: PROMPT"`

---

## Internal Flag: `--rep`

When `--rep <N>` is present in arguments, this is a continuation from a previous wake-up:
- Set `CURRENT_REP` to `N` instead of `1`
- Skip the initialization output from Step 1
- Go directly to Step 2 (execute) with output:
  ```
  [monomind:repeat] Run N/MAX_REPS starting...
  ```

---

## Interruption

The user can stop the loop at any time by interrupting. The next scheduled wake-up simply won't fire.
