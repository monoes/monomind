---
name: mastermind-monitor
description: Mastermind monitor — a forever-running task executor that watches Linear, GitHub Issues/PRs, Monotask boards, and filesystem folders for new tasks, claims them, executes them with the right agent, posts progress comments, and advances status at every stage. Supports per-user/per-state filtering, 3-retry failure handling, and a single concurrent task at a time (safe default). Persists state across cycles via ScheduleWakeup.
type: domain-skill
default_mode: confirm
---

# Mastermind Monitor

Invoked via `mastermind:monitor` or `/mastermind:monitor`.

A monitor is a named, forever-running task executor. It polls one or more task sources on a configurable interval, claims matching tasks, hands them off to a Claude agent for execution, posts back results as comments/status updates, and self-reschedules via `ScheduleWakeup`.

---

## CLI Flags

```
--action   start | stop | pause | resume | status | list | add-source | tick
--name     monitor name (slug, e.g. "dev-agent")
--source   linear | github | monotask | filesystem
--interval poll interval in seconds (default: 120)
--user     filter by assignee username/email (can be repeated)
--state    filter by task state/status (can be repeated, default: open/todo)
--max-concurrent  max tasks in flight (default: 1)
--agent    agent type to execute tasks (default: coder)
--project  monotask project/board name, or gh repo (org/repo)
--team     Linear team ID or slug
--folder   filesystem folder path to watch (for source=filesystem)
--label    filter by label (can be repeated)
--caller   command | master (internal — skip brain load if "command")
```

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following `_protocol.md` Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Monitor Config Directory

```bash
MONITOR_DIR=".monomind/monitor"
mkdir -p "$MONITOR_DIR"
```

---

## Step 2 — Dispatch by Action

### `list` (default when no --action)

```bash
echo "MONITORS"
echo "────────────────────────────────────────"
for f in "$MONITOR_DIR"/*.json; do
  [ -f "$f" ] || continue
  jq -r '
    "[\(.name)]  status=\(.status // "active")  interval=\(.poll_interval)s  agent=\(.agent_type)
    sources: \([(.sources // [])[].type] | join(", "))
    last_tick: \(.last_tick // "never")  tasks_done: \(.stats.done // 0)  tasks_failed: \(.stats.failed // 0)"
  ' "$f"
  echo ""
done
```

---

### `start`

Creates a new monitor config and triggers the first tick.

**Required:** `--name`

```bash
cfg="$MONITOR_DIR/${name}.json"
if [ -f "$cfg" ]; then
  echo "Monitor '$name' already exists. Use --action resume to restart it."
  exit 0
fi

cat > "$cfg" <<EOF
{
  "name": "${name}",
  "status": "active",
  "poll_interval": ${interval:-120},
  "agent_type": "${agent:-coder}",
  "max_concurrent": ${max_concurrent:-1},
  "sources": [],
  "users": [],
  "states": [],
  "labels": [],
  "stats": { "done": 0, "failed": 0, "retried": 0, "total_claimed": 0 },
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "last_tick": null
}
EOF

echo "Monitor '$name' created."
echo "Add sources with: /mastermind:monitor --action add-source --name $name --source linear ..."
echo "Then start the tick loop."
```

After creating the config, if at least one source was provided (via `--source` + related flags), also run the `add-source` logic for each provided source before the loop starts.

Then **immediately call `ScheduleWakeup`** with:
- `delaySeconds`: 10 (first tick almost immediately)
- `prompt`: `/mastermind:monitor --action tick --name <name>`
- `reason`: `First tick for monitor: <name>`

---

### `stop`

```bash
cfg="$MONITOR_DIR/${name}.json"
[ ! -f "$cfg" ] && echo "Monitor '$name' not found." && exit 1
tmp="${cfg}.tmp"
jq '.status = "stopped"' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
echo "Monitor '$name' stopped. It will not reschedule after the current tick finishes."
```

---

### `pause` / `resume`

```bash
cfg="$MONITOR_DIR/${name}.json"
[ ! -f "$cfg" ] && echo "Monitor '$name' not found." && exit 1
tmp="${cfg}.tmp"
new_status=$([ "$action" = "pause" ] && echo "paused" || echo "active")
jq --arg s "$new_status" '.status = $s' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
echo "Monitor '$name' is now: $new_status"
[ "$action" = "resume" ] && echo "Scheduling next tick..." # then call ScheduleWakeup
```

If `action=resume`, call `ScheduleWakeup`:
- `delaySeconds`: 10
- `prompt`: `/mastermind:monitor --action tick --name <name>`
- `reason`: `Resuming monitor: <name>`

---

### `status`

```bash
cfg="$MONITOR_DIR/${name}.json"
state_file="$MONITOR_DIR/${name}-state.json"
[ ! -f "$cfg" ] && echo "Monitor '$name' not found." && exit 1

jq -r '
  "MONITOR: \(.name)",
  "Status:  \(.status)",
  "Agent:   \(.agent_type)  |  Interval: \(.poll_interval)s  |  Max concurrent: \(.max_concurrent)",
  "Last tick: \(.last_tick // "never")",
  "",
  "Stats:",
  "  Claimed: \(.stats.total_claimed)  Done: \(.stats.done)  Failed: \(.stats.failed)  Retried: \(.stats.retried)",
  "",
  "Sources (\(.sources | length)):"
' "$cfg"

jq -r '(.sources // [])[] | "  [\(.type)] \(.filter | to_entries | map("\(.key)=\(.value)") | join("  "))"' "$cfg"

if [ -f "$state_file" ]; then
  in_flight=$(jq '.in_flight // [] | length' "$state_file" 2>/dev/null || echo 0)
  echo ""
  echo "In-flight tasks: $in_flight"
  jq -r '.in_flight[]? |
    "  [\(.source_type):\(.external_id)] claimed_at=\(.claimed_at) retry=\(.retry_count) last_failure=\(.last_failure // "n/a")"' \
    "$state_file" 2>/dev/null
fi
```

---

### `add-source`

Appends a new source adapter config to an existing monitor.

**Required:** `--name`, `--source`

```bash
cfg="$MONITOR_DIR/${name}.json"
[ ! -f "$cfg" ] && echo "Monitor '$name' not found. Run --action start first." && exit 1
```

Build the source object based on `--source`:

**linear:**
```json
{
  "type": "linear",
  "filter": {
    "team": "<--team value>",
    "assignees": ["<--user values>"],
    "states": ["<--state values, default: Todo>"],
    "labels": ["<--label values>"],
    "project": "<--project value if given>"
  }
}
```

**github:**
```json
{
  "type": "github",
  "filter": {
    "repo": "<--project value, e.g. org/repo>",
    "assignee": "<--user value>",
    "labels": ["<--label values>"],
    "state": "<--state value, default: open>",
    "type": "issue"
  }
}
```

**monotask:**
```json
{
  "type": "monotask",
  "filter": {
    "board": "<--project value>",
    "column": "<--state value, default: Todo>",
    "label": "<--label value, default: role:ai-agent>"
  }
}
```

**filesystem:**
```json
{
  "type": "filesystem",
  "filter": {
    "folder": "<--folder value>",
    "glob": "*.task",
    "user": "<--user value>"
  }
}
```

**Repeated-flag parsing rule:** When `--user`, `--state`, or `--label` is specified multiple times, collect the values into space-separated shell variables `$users`, `$states`, `$labels` (e.g. `users="alice bob"` from `--user alice --user bob`). Single-occurrence flags (`--team`, `--project`, `--folder`) map to `$team`, `$project`, `$folder` directly.

> **Linear multi-assignee:** The Linear MCP tool (`mcp__claude_ai_Linear__list_issues`) does not support multiple assignees in a single query. When `$users` contains more than one value, loop over each user and merge results client-side before dedup filtering. For simplicity in v1, only `filter.assignees[0]` is sent per query cycle — document this limitation to users.

> **Before calling any `mcp__claude_ai_Linear__*` tool**, confirm availability with `ToolSearch` (`select:mcp__claude_ai_Linear__list_issues,mcp__claude_ai_Linear__save_issue,mcp__claude_ai_Linear__save_comment`) and load the schema. If the Linear MCP server is not registered, skip the Linear source for this tick with a warning.

Build and append the source object using `jq -n` — construct the JSON from flags, then append:

```bash
# Build src_json based on --source type:
# Repeated flags collected as space-separated: $users, $states, $labels
# Derive singular $user / $state / $label from first value (adapters that take one value)
user="${users%% *}"
state="${states%% *}"
label="${labels%% *}"

case "$source" in
  linear)
    assignees_json=$([ -n "$users"  ] && printf '%s\n' $users  | jq -R . | jq -sc '.' || echo '[]')
    states_json=$([ -n "$states" ] && printf '%s\n' $states | jq -R . | jq -sc '.' || echo '["Todo"]')
    labels_json=$([ -n "$labels" ] && printf '%s\n' $labels | jq -R . | jq -sc '.' || echo '[]')
    src_json=$(jq -cn \
      --arg team "${team:-}" \
      --arg project "${project:-}" \
      --argjson assignees "$assignees_json" \
      --argjson states "$states_json" \
      --argjson labels "$labels_json" \
      '{"type":"linear","filter":{"team":$team,"assignees":$assignees,"states":$states,"labels":$labels,"project":$project}}')
    ;;
  github)
    labels_json=$([ -n "$labels" ] && printf '%s\n' $labels | jq -R . | jq -sc '.' || echo '[]')
    src_json=$(jq -cn \
      --arg repo "${project:-}" \
      --arg assignee "${user:-}" \
      --argjson labels "$labels_json" \
      --arg state "${state:-open}" \
      '{"type":"github","filter":{"repo":$repo,"assignee":$assignee,"labels":$labels,"state":$state,"type":"issue"}}')
    ;;
  monotask)
    src_json=$(jq -cn \
      --arg board "${project:-}" \
      --arg column "${state:-Todo}" \
      --arg label "${label:-role:ai-agent}" \
      '{"type":"monotask","filter":{"board":$board,"column":$column,"label":$label}}')
    ;;
  filesystem)
    src_json=$(jq -cn \
      --arg folder "${folder:-./tasks}" \
      --arg user "${user:-}" \
      '{"type":"filesystem","filter":{"folder":$folder,"glob":"*.task","user":$user}}')
    ;;
  *)
    echo "Unknown source type: $source. Supported: linear | github | monotask | filesystem"
    exit 1
    ;;
esac

tmp="${cfg}.tmp"
jq --argjson src "$src_json" '.sources += [$src]' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
echo "Source added to monitor '$name'."
```

---

### `tick` — The Main Execution Loop

This is the heart of the monitor. Called by `ScheduleWakeup` every `poll_interval` seconds.

> **Execution model:** bash code blocks in this section are executable fragments. Prose instructions between blocks complete the control flow (ScheduleWakeup calls, conditional branches, `fi` closures). Follow both the code and the prose — neither is complete without the other.

**Required:** `--name`

```bash
cfg="$MONITOR_DIR/${name}.json"
state_file="$MONITOR_DIR/${name}-state.json"

# Load config
[ ! -f "$cfg" ] && echo "Monitor '$name' not found — loop terminated." && exit 0

monitor_status=$(jq -r '.status // "active"' "$cfg")
[ "$monitor_status" = "stopped" ]  && echo "Monitor '$name' stopped — loop terminated." && exit 0
[ "$monitor_status" = "paused" ]   && echo "Monitor '$name' paused — will not reschedule." && exit 0

# Init state file if missing
[ ! -f "$state_file" ] && echo '{"processed_ids":{},"in_flight":[]}' > "$state_file"

max_concurrent=$(jq -r '.max_concurrent // 1' "$cfg")
agent_type=$(jq -r '.agent_type // "coder"' "$cfg")
poll_interval=$(jq -r '.poll_interval // 120' "$cfg")
```

**In-flight guard** — if at capacity, reschedule and stop this tick:
```bash
in_flight_count=$(jq '.in_flight // [] | length' "$state_file")
in_flight_count=${in_flight_count:-0}
if [ "$in_flight_count" -ge "$max_concurrent" ]; then
  echo "[$name] In-flight ($in_flight_count) >= max_concurrent ($max_concurrent) — skipping claim this tick."
  # Reschedule next tick — do this BEFORE exit so the loop survives
  # ScheduleWakeup: delaySeconds=poll_interval, prompt="/mastermind:monitor --action tick --name <name>",
  #   reason="Monitor <name> in-flight throttle — will retry next tick"
  exit 0
fi
```

> **Note:** The ScheduleWakeup call above is pseudocode inside the comment. Claude must call the actual `ScheduleWakeup` tool at this point, then `exit 0`. The `exit 0` here is a bash signal that the tick logic description treats as "stop further processing in this tick"; it does NOT skip the ScheduleWakeup — that fires first.

**Check for retry-pending tasks (before polling sources):**

If a previous task failed but has retry_count < 3, it remains in `in_flight` with `status = "retry_pending"`. Re-execute it instead of polling for a new task:

```bash
retry_task=$(jq -c '
  (.in_flight // [])[] as $t |
  (.processed_ids[($t.source_type + ":" + $t.external_id)].status // "") |
  if . == "retry_pending" then $t else empty end' "$state_file" | head -1)
```

If `retry_task` is non-empty, bind it as the active task and jump to Step 3:

```bash
if [ -n "$retry_task" ]; then
  task_json="$retry_task"
  task_source_type=$(echo "$task_json" | jq -r '.source_type')
  task_external_id=$(echo "$task_json" | jq -r '.external_id')
  task_title=$(echo "$task_json"       | jq -r '.title')
  echo "[$name] Retrying task: $task_title (source=$task_source_type id=$task_external_id)"
  # Proceed directly to Step 3 — skip source polling and the "After claim" section
fi
```

When `retry_task` is non-empty, the source loop below is skipped entirely (guarded by `if [ -z "$retry_task" ]`). `task_claimed` remains `false`, so the "After claim" registration block is also bypassed — the task is already registered in `in_flight` from its original claim.

**Update last_tick:**
```bash
tmp="${cfg}.tmp"
jq --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.last_tick = $ts' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
```

**Emit dashboard event:**
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
SESSION_ID="monitor-${name}-$(date -u +%Y%m%dT%H%M%S)"
curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg sid "$SESSION_ID" --arg name "$name" \
    '{type:"monitor:tick",session:$sid,monitor:$name,ts:(now*1000|floor)}')" || true
```

**Poll each source (in order, stop after first claimable task found):**

Source polling is skipped when a retry task is available (guarded below). The loop, the `case` dispatch, and each adapter are all inside the `if [ -z "$retry_task" ]` block:

```bash
task_claimed=false
if [ -z "$retry_task" ]; then
  task_json=""
  while IFS= read -r src; do
    src_type=$(echo "$src" | jq -r '.type')
    case "$src_type" in
      linear)
        # === Linear adapter (below) ===
```

> The `case` block continues through all adapters. After the Filesystem adapter closes its inner loop and `fi`, add `esac` → `done < <(jq -c '(.sources // [])[]' "$cfg")` → `fi` (closing the `if [ -z "$retry_task" ]` guard). After the outer `fi`, check `$task_claimed` to decide whether to run the "After claim" section.

---

#### Source Adapter: Linear

> **Before calling any `mcp__claude_ai_Linear__*` tool**, confirm availability with `ToolSearch` (`select:mcp__claude_ai_Linear__list_issues,mcp__claude_ai_Linear__save_issue,mcp__claude_ai_Linear__save_comment`). If the Linear MCP server is unavailable, skip this source for the current tick with a warning.

```bash
# Extract filter fields from $src
_lin_team=$(echo "$src"      | jq -r '.filter.team // ""')
_lin_assignee=$(echo "$src"  | jq -r '.filter.assignees[0] // ""')
_lin_states=$(echo "$src"    | jq -r '.filter.states // ["Todo"] | join(",")')
_lin_labels=$(echo "$src"    | jq -c '.filter.labels // []')
```

Use `mcp__claude_ai_Linear__list_issues` with:
- `teamId`: `$_lin_team`
- `assigneeId` / `assigneeEmail`: `$_lin_assignee` (if non-empty)
- State filter: resolved from `$_lin_states`
- Label filter applied client-side after fetch

The MCP call returns a JSON array. Bind it to a shell variable immediately after the call:

```bash
# issues = JSON array returned by mcp__claude_ai_Linear__list_issues
# Assign the raw JSON response to $issues before the loop below:
issues='[]'  # Claude MUST overwrite this with the real array returned by mcp__claude_ai_Linear__list_issues before the loop runs
```

Then iterate with an explicit bash loop (same pattern as Monotask/Filesystem adapters):

```bash
while IFS= read -r issue_json; do
  [ -z "$issue_json" ] && continue

  issue_id=$(echo "$issue_json"     | jq -r '.id')
  issue_title=$(echo "$issue_json"  | jq -r '.title')
  issue_desc=$(echo "$issue_json"   | jq -r '.description // ""')
  issue_url=$(echo "$issue_json"    | jq -r '.url // ""')
  issue_labels=$(echo "$issue_json" | jq -c '[(.labels // [])[] | .name]')
```

1. Check dedup — skip if already processed:
```bash
  already_processed=$(jq -r --arg id "linear:${issue_id}" '.processed_ids[$id] // empty' "$state_file")
  [ -n "$already_processed" ] && continue
```

2. Client-side label filter — skip if issue doesn't match configured labels:
```bash
  if [ "$(echo "$_lin_labels" | jq 'length')" -gt 0 ]; then
    has_label=$(jq -n --argjson want "$_lin_labels" --argjson got "$issue_labels" \
      '($want - ($want - $got)) | length > 0')
    [ "$has_label" != "true" ] && continue
  fi
```

3. Build task object:
```bash
  task_json=$(jq -cn \
    --arg eid    "$issue_id" \
    --arg title  "$issue_title" \
    --arg desc   "$issue_desc" \
    --arg url    "$issue_url" \
    --argjson labels "$issue_labels" \
    '{
      "source_type": "linear",
      "external_id": $eid,
      "title":       $title,
      "description": $desc,
      "url":         $url,
      "labels":      $labels
    }')
```

**Claim** (MCP — not bash): Call `mcp__claude_ai_Linear__save_issue` with:
- `issueId`: `$issue_id`
- Set state to "In Progress"
- Add label: `monitor:claimed`

**Progress comment** (MCP): Call `mcp__claude_ai_Linear__save_comment` with:
- `issueId`: `$issue_id`
- `body`: `"[Monitor: ${name}] Claimed by AI agent. Starting execution with agent type \`${agent_type}\`. Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"`

```bash
  task_claimed=true
  break 2  # break 2: exit per-issue loop AND outer source loop
done < <(echo "$issues" | jq -c '.[]')  # close per-issue loop
    ;;  # end linear case branch
```

---

#### Source Adapter: GitHub Issues/PRs

```bash
# Extract filter fields from $src
_gh_repo=$(echo "$src"     | jq -r '.filter.repo // ""')
_gh_assignee=$(echo "$src" | jq -r '.filter.assignee // ""')
_gh_state=$(echo "$src"    | jq -r '.filter.state // "open"')

# Build --label flags as an array (gh issue list takes one --label per flag, not comma-separated)
gh_label_args=()
while IFS= read -r _lbl; do
  [ -n "$_lbl" ] && gh_label_args+=(--label "$_lbl")
done < <(echo "$src" | jq -r '(.filter.labels // [])[]')

# Poll via gh CLI — capture into $issues
issues=$(gh issue list \
  --repo "$_gh_repo" \
  ${_gh_assignee:+--assignee "$_gh_assignee"} \
  "${gh_label_args[@]}" \
  --state "$_gh_state" \
  --json number,title,body,url,labels,assignees \
  --limit 20)
```

Iterate with an explicit bash loop:

```bash
while IFS= read -r issue_json; do
  [ -z "$issue_json" ] && continue

  number=$(echo "$issue_json" | jq -r '.number')
```

1. Check dedup — TWO checks required:
```bash
  # Local dedup: skip if already in processed_ids
  already_processed=$(jq -r --arg id "github:${number}" '.processed_ids[$id] // empty' "$state_file")
  [ -n "$already_processed" ] && continue

  # Remote dedup: skip if issue already has label monitor:claimed (externally labeled or other instance)
  already_claimed=$(echo "$issue_json" | jq -r '[(.labels // [])[] | .name] | index("monitor:claimed")')
  [ "$already_claimed" != "null" ] && continue
```

2. Build task object:
```bash
  task_json=$(jq -cn \
    --argjson issue "$issue_json" \
    --arg repo "$_gh_repo" \
    '{
      "source_type": "github",
      "external_id": ($issue.number | tostring),
      "title":       $issue.title,
      "description": ($issue.body // ""),
      "url":         $issue.url,
      "repo":        $repo,
      "labels":      [($issue.labels // [])[] | .name]
    }')
```

**Claim:** Run the GitHub Label Bootstrap (see end of file) using `$_gh_repo` before the first label operation — it is idempotent and only creates labels if missing. Then add labels:
```bash
  # Run GitHub Label Bootstrap here (see "GitHub Label Bootstrap" section) — idempotent, guarded
  gh issue edit "$number" --repo "$_gh_repo" --add-label "monitor:claimed,monitor:in-progress"
```

**Progress comment:**
```bash
  gh issue comment "$number" --repo "$_gh_repo" --body \
    "[Monitor: ${name}] Claimed by AI agent. Executing with \`${agent_type}\`. Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
```

```bash
  task_claimed=true
  break 2  # break 2: exit per-issue loop AND outer source loop
done < <(echo "$issues" | jq -c '.[]')  # close per-issue loop
    ;;  # end github case branch
```

**Stage labels** (applied progressively throughout execution):
- `monitor:claimed` → task picked up
- `monitor:in-progress` → agent is executing
- `monitor:review` → agent completed, awaiting human review (optional)
- `monitor:done` → fully complete
- `monitor:failed` → all retries exhausted

---

#### Source Adapter: Monotask

```bash
# Extract filter fields from $src
_mt_board=$(echo "$src"  | jq -r '.filter.board // ""')
_mt_col=$(echo "$src"    | jq -r '.filter.column // "Todo"')
_mt_label=$(echo "$src"  | jq -r '.filter.label // "role:ai-agent"')

# Resolve board_id from board title
board_id=$(monotask board list --json | jq -r --arg t "$_mt_board" '.[] | select(.title==$t) | .id' | head -1)
if [ -z "$board_id" ]; then
  echo "[monotask] Board '$_mt_board' not found — skipping source."
  # skip to next source adapter
else

# Resolve column ids
cols=$(monotask column list "$board_id" --json)
todo_col=$(echo "$cols"  | jq -r --arg t "$_mt_col" '.[] | select(.title==$t) | .id' | head -1)
doing_col=$(echo "$cols" | jq -r '.[] | select(.title=="Doing" or .title=="In Progress") | .id' | head -1)
done_col=$(echo "$cols"  | jq -r '.[] | select(.title=="Done") | .id' | head -1)

# Poll: unclaimed cards in todo column with matching label
cards=$(monotask card list "$board_id" --col "$todo_col" --label "$_mt_label" --json \
  | jq '[.[] | select((.labels // []) | index("claimed") | not)]')
```

Iterate over cards with an explicit bash loop (same pattern as the filesystem adapter):

```bash
while IFS= read -r card; do
  [ -z "$card" ] && continue

  card_id=$(echo "$card"    | jq -r '.id')
  card_title=$(echo "$card" | jq -r '.title')
```

1. Check dedup:
```bash
  already_processed=$(jq -r --arg id "monotask:${card_id}" '.processed_ids[$id] // empty' "$state_file")
  [ -n "$already_processed" ] && continue
```

**Build task object** (includes board/column IDs so Step 4 can re-extract them from `task_json` without relying on polling-scope shell vars):
```bash
  task_json=$(jq -cn \
    --arg eid      "$card_id" \
    --arg title    "$card_title" \
    --arg board    "$board_id" \
    --arg doing    "$doing_col" \
    --arg done     "$done_col" \
    '{
      "source_type": "monotask",
      "external_id": $eid,
      "title":       $title,
      "description": "",
      "board_id":    $board,
      "doing_col":   $doing,
      "done_col":    $done
    }')
```

**Claim:**
```bash
  monotask card move "$board_id" "$card_id" "$doing_col" --json
  monotask card label add "$board_id" "$card_id" "claimed" --json
  monotask card label add "$board_id" "$card_id" "monitor:in-progress" --json
```

**Progress comment:**
```bash
  monotask card comment add "$board_id" "$card_id" \
    "[Monitor: ${name}] Claimed by AI agent. Executing with \`${agent_type}\`. Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  task_claimed=true
  break 2  # break 2: exit per-card loop AND outer source loop
done < <(echo "$cards" | jq -c '.[]')   # close per-card loop
fi  # close 'if [ -z "$board_id" ]' else block
    ;;  # end monotask case branch
```

---

#### Source Adapter: Filesystem

```bash
# Extract filter fields from $src
folder=$(echo "$src" | jq -r '.filter.folder // "./tasks"')

if [ ! -d "$folder" ]; then
  echo "[filesystem] Folder '$folder' not found — skipping source."
  # skip to next source adapter
else

# Poll: find unclaimed .task files
tasks=$(find "$folder" -name "*.task" -not -name "*.claimed" -not -name "*.done" -not -name "*.failed" 2>/dev/null)

# Iterate — stop after first claimable file
while IFS= read -r task_file; do
  [ -z "$task_file" ] && continue
```

(All per-file steps are inside this while loop; close with `done <<< "$tasks"` after the claim. Then close the `else` block with `fi`.)

For each `.task` file (`task_file` = absolute path):
1. Check dedup:
```bash
  already_processed=$(jq -r --arg id "filesystem:${task_file}" '.processed_ids[$id] // empty' "$state_file")
  [ -n "$already_processed" ] && continue
```
2. Read task content:
```bash
task_title=$(head -1 "$task_file")
task_description=$(tail -n +2 "$task_file")
task_base="${task_file%.task}"
task_json=$(jq -cn \
  --arg title       "$task_title" \
  --arg description "$task_description" \
  --arg eid         "$task_file" \
  --arg base_path   "$task_base" \
  '{
    "source_type": "filesystem",
    "external_id": $eid,
    "title":       $title,
    "description": $description,
    "base_path":   $base_path
  }')
```

**Claim:**
```bash
mv "${task_file}" "${task_base}.task.claimed"
```

**Progress log:**
```bash
echo "[Monitor: ${name}] $(date -u +%Y-%m-%dT%H:%M:%SZ) — Claimed. Executing with ${agent_type}." \
  >> "${task_base}.task.log"
```

```bash
  task_claimed=true
  break 2  # break 2: exit per-file loop AND outer source loop
done <<< "$tasks"   # close per-file while loop (reached only if no file was claimed)
fi                  # close 'if [ ! -d "$folder" ]' else block
      ;;  # end filesystem case branch
    esac
  done < <(jq -c '(.sources // [])[]' "$cfg")
fi  # close 'if [ -z "$retry_task" ]' guard
# After: if $task_claimed=true, proceed to "After claim"; otherwise skip to Step 5
```

**Stage files:** `.task` → `.task.claimed` → `.task.done` or `.task.failed`

---

#### After a task is claimed (all sources — common code)

This section runs ONLY when `task_claimed = true` (a task was found and claimed in the source loop above). The retry path sets `task_json=$retry_task` and jumps directly to Step 3, bypassing this section entirely.

```bash
if [ "$task_claimed" = "true" ]; then
```

Each source adapter MUST have set `task_json` to a complete JSON object before `task_claimed=true`. The full task object includes all fields used by Step 3 and Step 4 for that source type.

**Extract task metadata (must run first, before all blocks below):**
```bash
task_source_type=$(echo "$task_json" | jq -r '.source_type')
task_external_id=$(echo "$task_json" | jq -r '.external_id')
task_title=$(echo "$task_json"       | jq -r '.title')
```

**Register in state as in-flight** (stores full task object for retry replay):
```bash
tmp="${state_file}.tmp"
jq --argjson task "$task_json" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.in_flight += [$task + {"claimed_at": $ts, "retry_count": 0}]' \
   "$state_file" > "$tmp" && mv "$tmp" "$state_file"
```

**Mark as processed in dedup index:**
```bash
tmp="${state_file}.tmp"
jq --arg key "${task_source_type}:${task_external_id}" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.processed_ids[$key] = {status: "in_flight", claimed_at: $ts, retry_count: 0}' \
   "$state_file" > "$tmp" && mv "$tmp" "$state_file"
```

**Increment stats:**
```bash
tmp="${cfg}.tmp"
jq '.stats.total_claimed += 1' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
fi  # end 'if [ "$task_claimed" = "true" ]'
```

---

## Step 3 — Execute the Task

**Guard:** Only execute Step 3 and Step 4 when a task was actually claimed or retried. On idle ticks (no task available, no retry pending), skip directly to Step 5.

```bash
if [ -n "$task_json" ]; then
```

Spawn a Task agent to do the actual work. This runs **synchronously** (`run_in_background: false`) so we can capture the result and update status.

The return value of the `Task` tool call is the agent's full text output. Capture it into `agent_output`:

```javascript
agent_output = Task({
  subagent_type: agent_type,   // from monitor config
  description: `Monitor "${name}" executing: ${task.title}`,
  run_in_background: false,
  prompt: `You are an AI agent executing a task claimed by the Mastermind Monitor "${name}".

TASK: ${task.title}

DESCRIPTION:
${task.description || "(no description provided)"}

SOURCE: ${task.source_type}  |  ID: ${task.external_id}
URL: ${task.url || "n/a"}

INSTRUCTIONS:
1. Understand the task from the title and description above.
2. Execute the task fully and completely using available tools.
3. For code tasks: read relevant files, make changes, run tests if possible.
4. For research tasks: gather information, synthesize findings.
5. Produce a clear result summary at the end.

OUTPUT FORMAT:
At the end of your work, output a JSON block EXACTLY like this:
\`\`\`json
{
  "status": "done|failed",
  "summary": "one paragraph summary of what was accomplished",
  "artifacts": ["list of files changed or created"],
  "next_actions": ["any follow-up suggestions"]
}
\`\`\`

If you encounter an error you cannot recover from, set status to "failed" and explain in summary.`
})
```

`agent_output` is the full text returned by the Task call. Parse the JSON block and extract the task metadata for use in Step 4. The metadata vars (`task_source_type`, `task_external_id`, `task_title`) are already set by the "After claim" common code for new tasks, and by the retry branch for retried tasks — this block re-extracts them from `$task_json` as a safety guard:

```bash
# Task metadata (safe re-extract — already set by claim/retry path)
task_source_type=$(echo "$task_json" | jq -r '.source_type')
task_external_id=$(echo "$task_json" | jq -r '.external_id')
task_title=$(echo "$task_json"       | jq -r '.title')

# Parse result JSON block from agent_output (all three fields in one python pass)
_result_json=$(echo "$agent_output" | python3 -c "
import sys, re, json
m = re.search(r'\`\`\`json\s*(\{.*?\})\s*\`\`\`', sys.stdin.read(), re.DOTALL)
print(m.group(1) if m else '{}')" 2>/dev/null || echo '{}')

result_status=$(echo "$_result_json"        | jq -r '.status          // "failed"')
result_summary=$(echo "$_result_json"       | jq -r '.summary         // "(no summary)"')
result_artifacts=$(echo "$_result_json"     | jq -r '(.artifacts    // []) | join(", ")')
result_next_actions=$(echo "$_result_json"  | jq -r '(.next_actions // []) | join(", ")')
```

---

## Step 4 — Handle Result

Branch on `result_status`:

```bash
if [ "$result_status" = "done" ]; then
```

### On success (`status: "done"`)

**Post completion comment/update per source** — dispatch on `$task_source_type`:

**Linear** (MCP tool calls — not bash; load Linear MCP schema via ToolSearch first): for `task_source_type=linear`:

Call `mcp__claude_ai_Linear__save_comment` with:
- `issueId`: `$task_external_id`
- `body`: pass the following as a real multi-line string (use actual newline characters — do NOT use `\n` escape sequences per the Linear MCP server requirement):

```
[Monitor: ${name}] ✓ Task complete.

Summary: ${result_summary}

Artifacts: ${result_artifacts}
Next actions: ${result_next_actions}

Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)  |  Agent: ${agent_type}
```

Then call `mcp__claude_ai_Linear__save_issue` with:
- `issueId`: `$task_external_id`
- `stateId`: resolved ID for state name "Done" in this team

**GitHub, Monotask, Filesystem** — dispatched via `case`:
```bash
case "$task_source_type" in
  github)
    task_repo=$(echo "$task_json" | jq -r '.repo')
    gh issue comment "$task_external_id" --repo "$task_repo" --body \
      "[Monitor: ${name}] Task complete.

Summary: ${result_summary}

Artifacts: ${result_artifacts}
Next actions: ${result_next_actions}
Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

    gh issue edit "$task_external_id" --repo "$task_repo" \
      --remove-label "monitor:in-progress" \
      --add-label "monitor:done"

    # If it was a "complete this task" issue, close it:
    # gh issue close "$task_external_id" --repo "$task_repo" --comment "Closed by monitor after completion."
    ;;
  monotask)
    # Re-extract from task_json — polling-scope vars are not reliable on retry path
    board_id=$(echo "$task_json"  | jq -r '.board_id')
    card_id=$(echo "$task_json"   | jq -r '.external_id')
    done_col=$(echo "$task_json"  | jq -r '.done_col')

    monotask card comment add "$board_id" "$card_id" \
      "[Monitor: ${name}] Task complete.

Summary: ${result_summary}

Artifacts: ${result_artifacts}
Next actions: ${result_next_actions}
Completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

    monotask card move "$board_id" "$card_id" "$done_col" --json
    monotask card label remove "$board_id" "$card_id" "monitor:in-progress" --json
    monotask card label add    "$board_id" "$card_id" "monitor:done" --json
    ;;
  filesystem)
    task_base=$(echo "$task_json" | jq -r '.base_path')
    echo "[Monitor: ${name}] $(date -u +%Y-%m-%dT%H:%M:%SZ) — DONE." >> "${task_base}.task.log"
    echo "Summary: ${result_summary}" >> "${task_base}.task.log"
    echo "Artifacts: ${result_artifacts}" >> "${task_base}.task.log"
    echo "Next actions: ${result_next_actions}" >> "${task_base}.task.log"
    mv "${task_base}.task.claimed" "${task_base}.task.done"
    ;;
esac  # end task_source_type dispatch (success path)
```

**Update state — remove from in-flight, mark done:**
```bash
tmp="${state_file}.tmp"
jq --arg key "${task_source_type}:${task_external_id}" \
   --arg eid "$task_external_id" \
   --arg stype "$task_source_type" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '(.processed_ids[$key].status = "done") |
    (.processed_ids[$key].done_at  = $ts) |
    (.in_flight = [(.in_flight // [])[] | select(.external_id != $eid or .source_type != $stype)])' \
   "$state_file" > "$tmp" && mv "$tmp" "$state_file"

tmp="${cfg}.tmp"
jq '.stats.done += 1' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
```

**Emit dashboard event:**
```bash
curl -s -o /dev/null -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn --arg sid "$SESSION_ID" --arg name "$name" --arg title "$task_title" \
    '{type:"monitor:task:done",session:$sid,monitor:$name,task:$title,ts:(now*1000|floor)}')" || true
```

```bash
else  # result_status != "done"
```

### On failure

**Retry logic (max 3 attempts):**

```bash
retry_count=$(jq -r --arg key "${task_source_type}:${task_external_id}" \
  '.processed_ids[$key].retry_count // 0' "$state_file")

if [ "$retry_count" -lt 3 ]; then
  new_retry=$((retry_count + 1))
  echo "[$name] Task failed (attempt $new_retry/3). Will retry next tick."

  # Update retry count in state
  tmp="${state_file}.tmp"
  jq --arg key "${task_source_type}:${task_external_id}" \
     --arg eid "$task_external_id" \
     --arg stype "$task_source_type" \
     --argjson r "$new_retry" \
     --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '(.processed_ids[$key].retry_count = $r) |
      (.processed_ids[$key].last_failure = $ts) |
      (.processed_ids[$key].status = "retry_pending") |
      (.in_flight = [(.in_flight // [])[] |
        if (.external_id == $eid and .source_type == $stype)
        then .retry_count = $r | .last_failure = $ts
        else . end])' \
     "$state_file" > "$tmp" && mv "$tmp" "$state_file"

  tmp="${cfg}.tmp"
  jq '.stats.retried += 1' "$cfg" > "$tmp" && mv "$tmp" "$cfg"

  # Post retry comment per source
  _retry_msg="[Monitor: ${name}] Task failed (attempt ${new_retry}/3). Will retry next tick. Error: ${result_summary}"
  # Linear (MCP — not bash): call mcp__claude_ai_Linear__save_comment with
  #   issueId=$task_external_id  body="$_retry_msg"
  # Then call mcp__claude_ai_Linear__save_issue to set state back to "In Progress".

  case "$task_source_type" in
    github)
      task_repo=$(echo "$task_json" | jq -r '.repo')
      gh issue comment "$task_external_id" --repo "$task_repo" --body "$_retry_msg" 2>/dev/null || true
      ;;
    monotask)
      _board=$(echo "$task_json" | jq -r '.board_id')
      monotask card comment add "$_board" "$task_external_id" "$_retry_msg" 2>/dev/null || true
      ;;
    filesystem)
      _base=$(echo "$task_json" | jq -r '.base_path')
      echo "[Monitor: ${name}] $(date -u +%Y-%m-%dT%H:%M:%SZ) — RETRY ${new_retry}/3. ${result_summary}" >> "${_base}.task.log"
      ;;
  esac

else
  echo "[$name] Task failed after 3 attempts. Marking as failed."

  # Post final failure comment and set external status per source
  _fail_msg="[Monitor: ${name}] Task failed after 3 attempts. Manual intervention required.
Error: ${result_summary}
Last attempt: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # Linear (MCP — not bash): call mcp__claude_ai_Linear__save_comment with
  #   issueId=$task_external_id  body="$_fail_msg"
  # Then call mcp__claude_ai_Linear__save_issue to:
  #   - remove labels "monitor:claimed" and "monitor:in-progress"
  #   - add label "monitor:failed"
  #   - set state to "Cancelled" or "Blocked" as appropriate for the team.

  case "$task_source_type" in
    github)
      task_repo=$(echo "$task_json" | jq -r '.repo')
      gh issue comment "$task_external_id" --repo "$task_repo" --body "$_fail_msg" 2>/dev/null || true
      gh issue edit "$task_external_id" --repo "$task_repo" \
        --add-label "monitor:failed" --remove-label "monitor:in-progress" 2>/dev/null || true
      ;;
    monotask)
      _board=$(echo "$task_json" | jq -r '.board_id')
      monotask card comment add "$_board" "$task_external_id" "$_fail_msg" 2>/dev/null || true
      monotask card label remove "$_board" "$task_external_id" "monitor:in-progress" 2>/dev/null || true
      monotask card label add    "$_board" "$task_external_id" "monitor:failed" 2>/dev/null || true
      ;;
    filesystem)
      _base=$(echo "$task_json" | jq -r '.base_path')
      echo "[Monitor: ${name}] $(date -u +%Y-%m-%dT%H:%M:%SZ) — FAILED after 3 attempts. ${result_summary}" >> "${_base}.task.log"
      mv "${_base}.task.claimed" "${_base}.task.failed" 2>/dev/null || true
      ;;
  esac

  # Update state
  tmp="${state_file}.tmp"
  jq --arg key "${task_source_type}:${task_external_id}" \
     --arg eid "$task_external_id" \
     --arg stype "$task_source_type" \
     --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '(.processed_ids[$key].status = "failed") |
      (.processed_ids[$key].failed_at = $ts) |
      (.in_flight = [(.in_flight // [])[] | select(.external_id != $eid or .source_type != $stype)])' \
     "$state_file" > "$tmp" && mv "$tmp" "$state_file"

  tmp="${cfg}.tmp"
  jq '.stats.failed += 1' "$cfg" > "$tmp" && mv "$tmp" "$cfg"
fi  # end permanent-fail branch (if retry_count -lt 3 ... else ... fi)
fi  # end result_status branch (if result_status = "done" ... else ... fi)

fi  # end task guard (if [ -n "$task_json" ]; only runs Steps 3-4 when a task was claimed or retried)
```

---

## Step 5 — Reschedule Next Tick

Always the last step, regardless of whether a task was found/executed.

Call `ScheduleWakeup` with:
- `delaySeconds`: value of `poll_interval` from config (default 120)
- `prompt`: `/mastermind:monitor --action tick --name <name>`
- `reason`: `Monitor <name> polling every <poll_interval>s (<N sources>)`

This is what makes the monitor run forever. The only way to stop it is to set `status=stopped` or `status=paused` — the tick checks this at the top of Step 2.

---

## Step 6 — Return Output

```yaml
domain: ops
status: complete
action: <action>
monitor: <name>
tasks_this_tick: <0 or 1>
task_result: <done|failed|retry_pending|none>
next_tick_in: <poll_interval>s
state_file: .monomind/monitor/<name>-state.json
run_id: <SESSION_ID>
```

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow `_protocol.md` Brain Write Procedure for domain `ops`.

---

## Configuration File Schemas

### `.monomind/monitor/<name>.json`

```json
{
  "name": "dev-agent",
  "status": "active",
  "poll_interval": 120,
  "agent_type": "coder",
  "max_concurrent": 1,
  "sources": [
    {
      "type": "linear",
      "filter": {
        "team": "ENG",
        "assignees": ["morteza@agent-f.com"],
        "states": ["Todo"],
        "labels": ["ai-agent"],
        "project": ""
      }
    },
    {
      "type": "github",
      "filter": {
        "repo": "monoes/monomind",
        "assignee": "nokhodian",
        "labels": ["ai-agent"],
        "state": "open",
        "type": "issue"
      }
    },
    {
      "type": "monotask",
      "filter": {
        "board": "monomind-tasks-dev",
        "column": "Todo",
        "label": "role:ai-agent"
      }
    },
    {
      "type": "filesystem",
      "filter": {
        "folder": "./tasks",
        "glob": "*.task",
        "user": ""
      }
    }
  ],
  "stats": {
    "done": 0,
    "failed": 0,
    "retried": 0,
    "total_claimed": 0
  },
  "created_at": "2026-05-18T00:00:00Z",
  "last_tick": null
}
```

### `.monomind/monitor/<name>-state.json`

```json
{
  "processed_ids": {
    "linear:LIN-123": {
      "status": "done",
      "claimed_at": "2026-05-18T10:00:00Z",
      "done_at": "2026-05-18T10:05:00Z",
      "retry_count": 0
    },
    "github:456": {
      "status": "failed",
      "claimed_at": "2026-05-18T09:00:00Z",
      "failed_at": "2026-05-18T09:20:00Z",
      "retry_count": 3
    }
  },
  "in_flight": [
    {
      "source_type": "monotask",
      "external_id": "abc-uuid",
      "title": "Fix auth bug",
      "description": "",
      "board_id": "board-uuid-here",
      "doing_col": "doing-col-uuid",
      "done_col": "done-col-uuid",
      "claimed_at": "2026-05-18T10:10:00Z",
      "retry_count": 1,
      "last_failure": "2026-05-18T10:12:00Z"
    }
  ]
}
```

---

## Quick Reference — Common Commands

```bash
# Create a monitor watching GitHub issues assigned to you
/mastermind:monitor --action start --name dev-watcher \
  --source github --project monoes/monomind --user nokhodian \
  --label ai-agent --agent coder --interval 120

# Add a Linear source to an existing monitor
/mastermind:monitor --action add-source --name dev-watcher \
  --source linear --team ENG --user your@email.com \
  --state Todo --label ai-agent

# Add a monotask board source
/mastermind:monitor --action add-source --name dev-watcher \
  --source monotask --project monomind-tasks-dev \
  --state Todo --label role:ai-agent

# Add a filesystem folder source
/mastermind:monitor --action add-source --name dev-watcher \
  --source filesystem --folder ./tasks

# Check status
/mastermind:monitor --action status --name dev-watcher

# List all monitors
/mastermind:monitor

# Pause (stops auto-rescheduling after current tick)
/mastermind:monitor --action pause --name dev-watcher

# Resume (re-enters the tick loop)
/mastermind:monitor --action resume --name dev-watcher

# Stop permanently
/mastermind:monitor --action stop --name dev-watcher
```

---

## GitHub Label Bootstrap

Run this once, inline in the GitHub claim path, immediately before the first `gh issue edit` call. At claim time, `$_gh_repo` is in scope (extracted from `$src` at the top of the GitHub adapter). Guard with a check so it only runs when the `monitor:claimed` label is absent:

```bash
# Bootstrap monitor labels on every claim — --force makes each call idempotent (no-ops if label already exists)
# Running unconditionally is safe: 5 lightweight API calls, prevents gaps if any label was deleted externally
for label in "monitor:claimed" "monitor:in-progress" "monitor:review" "monitor:done" "monitor:failed"; do
  # shasum is available on both macOS and Linux; md5sum is Linux-only
  color=$(printf '%s' "$label" | shasum | cut -c1-6)
  gh label create "$label" --repo "$_gh_repo" --color "$color" --force 2>/dev/null || true
done
```

---

## Important Behavioral Notes

**`poll_interval` is idle gap, not heartbeat.** Because `tick` waits synchronously for the agent to finish before rescheduling (Step 3 uses `run_in_background: false`), `poll_interval` is the *minimum idle time between task claims* — not a wall-clock polling frequency. A user who sets `--interval 60` and has tasks that take 10 minutes will get one task claimed every ~10 minutes, not every 60 seconds.

**`max_concurrent` is a per-tick claim limit.** Since the default is 1 and the tick blocks on the agent, this means at most one task runs per cycle. Increasing it allows the monitor to claim and spawn multiple tasks per tick — but all still block the tick sequentially unless the Task calls use `run_in_background: true` (which requires manual result tracking).

**Retry-pending tasks are prioritized over new claims.** On each tick, the monitor first checks `in_flight` for any `retry_pending` entries and re-executes them before polling sources for new work. This ensures stuck tasks don't accumulate.

---

## Notes on Filter Precedence

When multiple users or states are specified (via repeated `--user` or `--state` flags), the monitor ORs them:
- `--user alice --user bob` → fetch tasks assigned to alice OR bob
- `--state Todo --state "In Progress"` → fetch tasks in either state

The `--label` flag is ANDed with user/state: only tasks matching the label AND the user/state filter are claimed.
