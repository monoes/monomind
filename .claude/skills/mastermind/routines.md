---
name: mastermind-routines
description: Mastermind routines — schedule recurring tasks that trigger agent heartbeats on a cron-like schedule within a running org. Configure concurrency policy and catch-up behavior.
type: domain-skill
default_mode: confirm
---

# Mastermind Routines

This skill is invoked by `mastermind:routines` or directly via `/mastermind:routines`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to manage routines for
- `action`: list | add | pause | resume | remove | trigger
- `routine_id`: slug of the routine (for pause/resume/remove/trigger)
- `routine_name`: display name (for add)
- `agent_id`: role id of the agent to trigger
- `schedule`: cron expression (e.g. "0 9 * * 1-5" = weekdays at 9am)
- `task_title`: task to create on each trigger
- `context`: optional context passed to agent on each heartbeat
- `concurrency`: coalesce_if_active | always_enqueue | skip_if_active (default: coalesce_if_active)
- `catchup`: skip_missed | enqueue_missed_with_cap (default: skip_missed)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Routines

Routines are stored in `.monomind/orgs/<org_name>-routines.json`:

```bash
routinesFile=".monomind/orgs/${org_name}-routines.json"
[ ! -f "$routinesFile" ] && echo '{"routines":[]}' > "$routinesFile"
```

---

## Step 2 — Execute Action

### list (default)

Show all routines with their schedule and status:

```bash
jq -r '
  (.routines // [])[] |
  "[\(.id)] \(.name)  agent=\(.agent_id)  schedule=\"\(.schedule)\"  status=\(.status // "active")\n" +
  "  task: \(.task_title)\n  concurrency: \(.concurrency)  catchup: \(.catchup)\n  last_run: \(.last_run // "never")  next_run: \(.next_run // "unknown")"
' "$routinesFile" 2>/dev/null || echo "No routines defined."
```

Render as:
```
ROUTINES — org: <org_name>
──────────────────────────────────────────────────────
[weekly-report] Weekly Status Report
  Agent:    boss  |  Schedule: 0 9 * * 1 (Mondays 9am)
  Status:   active
  Task:     "Compile weekly progress report from all agents"
  Concurrency: coalesce_if_active  |  Catchup: skip_missed
  Last run: 3 days ago  |  Next run: in 4 days

[daily-content] Daily Content Draft
  Agent:    content-writer  |  Schedule: 0 10 * * 1-5 (weekdays 10am)
  Status:   active
  Task:     "Draft one content piece for the content calendar"
  Concurrency: skip_if_active  |  Catchup: skip_missed
  Last run: yesterday  |  Next run: tomorrow 10am
```

### add

Add a new routine and register a ScheduleWakeup via Claude's native scheduler:

```bash
routine_id=$(echo "$routine_name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | tr -s '-')
tmp="${routinesFile}.tmp"
jq --arg id "$routine_id" \
   --arg name "$routine_name" \
   --arg agent "$agent_id" \
   --arg schedule "$schedule" \
   --arg task "$task_title" \
   --arg context "${context:-}" \
   --arg concurrency "${concurrency:-coalesce_if_active}" \
   --arg catchup "${catchup:-skip_missed}" \
   '.routines += [{
     "id":$id,"name":$name,"agent_id":$agent,"schedule":$schedule,
     "task_title":$task,"context":$context,"concurrency":$concurrency,
     "catchup":$catchup,"status":"active","created_at":(now|todate)
   }]' \
   "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"
echo "Routine added: $routine_id"
echo "Schedule: $schedule"
echo ""
echo "NOTE: To activate this routine, use ScheduleWakeup with:"
echo "  prompt: '/mastermind:routines --action trigger --org $org_name --routine-id $routine_id'"
echo "  delaySeconds: <seconds until next scheduled run>"
```

After creating, use `ScheduleWakeup` to schedule the first trigger at the appropriate delay based on the cron expression.

### trigger

Manually trigger a routine immediately (same as a scheduled run):

```bash
routine=$(jq --arg id "$routine_id" '(.routines // [])[] | select(.id == $id)' "$routinesFile")
rt_agent=$(echo "$routine" | jq -r '.agent_id')
rt_task=$(echo "$routine" | jq -r '.task_title')
rt_context=$(echo "$routine" | jq -r '.context // ""')
rt_concurrency=$(echo "$routine" | jq -r '.concurrency')

# Check concurrency policy
stateFile=".monomind/orgs/${org_name}-state.json"
[ ! -f "$stateFile" ] && echo '{"agents":{}}' > "$stateFile"
agent_status=$(jq -r --arg a "$rt_agent" '.agents[$a].status // "idle"' "$stateFile")

case "$rt_concurrency" in
  skip_if_active)
    [ "$agent_status" = "running" ] && { echo "Skipped: agent $rt_agent is already running (skip_if_active policy)"; exit 0; }
    ;;
  coalesce_if_active)
    # Queue at most one pending run
    ;;
esac
```

Then invoke the heartbeat skill logic: create a task card for `rt_task`, trigger the agent heartbeat.

Update routine's `last_run` and schedule next wakeup:

```bash
tmp="${routinesFile}.tmp"
jq --arg id "$routine_id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.routines = [(.routines // [])[] | if .id == $id then .last_run = $ts else . end]' \
   "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"
```

### pause / resume

```bash
tmp="${routinesFile}.tmp"
jq --arg id "$routine_id" --arg status "$action" \
   '.routines = [(.routines // [])[] | if .id == $id then .status = $status else . end]' \
   "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"
echo "Routine $routine_id set to: $action"
```

### remove

```bash
tmp="${routinesFile}.tmp"
jq --arg id "$routine_id" '.routines = [(.routines // [])[] | select(.id != $id)]' \
   "$routinesFile" > "$tmp" && mv "$tmp" "$routinesFile"
echo "Routine $routine_id removed."
```

---

## Concurrency Policies

| Policy | Behavior |
|--------|----------|
| `coalesce_if_active` | If a run is already active, keep just one follow-up queued |
| `always_enqueue` | Queue every trigger, even if routine is already running |
| `skip_if_active` | Drop new triggers while a run is active |

## Catch-up Policies

| Policy | Behavior |
|--------|----------|
| `skip_missed` | Ignore windows missed while paused/down |
| `enqueue_missed_with_cap` | Catch up missed windows in capped batches |

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
routine_id: <routine_id if applicable>
routines_count: <N>
routines_file: .monomind/orgs/<org_name>-routines.json
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
