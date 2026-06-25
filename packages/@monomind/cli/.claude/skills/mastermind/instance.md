---
name: mastermind-instance
description: Mastermind instance — global instance-level settings including scheduler heartbeat management across all orgs, system-wide configuration, and cross-org health overview.
type: domain-skill
default_mode: auto
---

# Mastermind Instance

This skill is invoked by `mastermind:instance` or directly via `/mastermind:instance`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `action`: show | heartbeats | toggle-heartbeat | set | health
- `agent_id`: agent id (required for toggle-heartbeat)
- `org_name`: org filter (optional)
- `key`: config key to set (for `set` action)
- `value`: value to set
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Instance Config

```bash
instanceFile=".monomind/instance.json"
if [ ! -f "$instanceFile" ]; then
  cat > "$instanceFile" <<'EOF'
{
  "version": "1.0",
  "scheduler": {
    "enabled": true,
    "default_heartbeat_interval": 900,
    "max_concurrent_heartbeats": 4
  },
  "limits": {
    "max_orgs": 20,
    "max_agents_per_org": 50,
    "max_tokens_per_day": 10000000
  },
  "heartbeat_agents": []
}
EOF
fi
```

---

## Step 2 — Execute Action

### show (default)

Display global instance configuration:

```bash
echo "MONOMIND INSTANCE SETTINGS"
echo "──────────────────────────────────────────"
jq -r '
  "  Version:                 \(.version // "1.0")",
  "  Scheduler enabled:       \(.scheduler.enabled // true)",
  "  Heartbeat interval:      \(.scheduler.default_heartbeat_interval // 900)s",
  "  Max concurrent beats:    \(.scheduler.max_concurrent_heartbeats // 4)",
  "",
  "LIMITS",
  "  Max orgs:                \(.limits.max_orgs // 20)",
  "  Max agents/org:          \(.limits.max_agents_per_org // 50)",
  "  Max tokens/day:          \(.limits.max_tokens_per_day // 10000000)"
' "$instanceFile"

echo ""
echo "ORGS"
orgs=$(ls .monomind/orgs/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments' | wc -l | tr -d ' ')
echo "  Active orgs: $orgs"
```

### heartbeats

List all agents across all orgs that have scheduled heartbeats:

```bash
echo "SCHEDULER HEARTBEATS"
echo "────────────────────────────────────────────────────────"
printf "%-20s %-20s %-14s %-10s %s\n" "ORG" "AGENT" "INTERVAL" "ENABLED" "LAST RUN"
echo "────────────────────────────────────────────────────────"

found=0
for orgF in .monomind/orgs/*.json; do
  [[ "$orgF" == *-state* || "$orgF" == *-goals* || "$orgF" == *-routines* || "$orgF" == *-approvals* ]] && continue
  [[ "$orgF" == *-projects* || "$orgF" == *-worktrees* || "$orgF" == *-members* || "$orgF" == *-adapters* ]] && continue
  [[ "$orgF" == *-plugins* || "$orgF" == *-bootstrap* || "$orgF" == *-activity* ]] && continue
  [[ "$orgF" == *-issues* || "$orgF" == *-workspaces* || "$orgF" == *-environments* ]] && continue

  orgName=$(basename "$orgF" .json)
  [ -n "$org_name" ] && [ "$orgName" != "$org_name" ] && continue

  stateFile=".monomind/orgs/${orgName}-state.json"
  jq -r --arg org "$orgName" '
    (.roles // [])[] |
    select(.heartbeat.enabled == true or (.runtimeConfig.heartbeat.enabled == true)) |
    [$org, .id,
     ((.heartbeat.interval // .runtimeConfig.heartbeat.interval // "900") | tostring) + "s",
     "yes",
     "-"]
    | @tsv' "$orgF" 2>/dev/null | while IFS=$'\t' read -r org agent interval enabled lastrun; do
    printf "%-20s %-20s %-14s %-10s %s\n" "$org" "$agent" "$interval" "$enabled" "$lastrun"
    found=$((found + 1))
  done
done

[ "$found" -eq 0 ] && echo "  No scheduled heartbeat agents found. Configure via /mastermind:heartbeat."
```

### toggle-heartbeat

Enable or disable the scheduler heartbeat for a specific agent:

```bash
[ -z "$agent_id" ] && { echo "ERROR: --agent-id required."; exit 1; }
[ -z "$org_name" ] && { echo "ERROR: --org required."; exit 1; }

orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

# Get current state
current=$(jq -r --arg id "$agent_id" \
  '(.roles // [])[] | select(.id == $id) | .heartbeat.enabled // false' "$orgFile" 2>/dev/null || echo "false")
newState=$([ "$current" = "true" ] && echo "false" || echo "true")

tmp="${orgFile}.tmp"
jq --arg id "$agent_id" --argjson enabled "$newState" \
  '.roles = [(.roles // [])[] | if .id == $id then .heartbeat.enabled = $enabled else . end]' \
  "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"

echo "Heartbeat for '$agent_id' → $([ "$newState" = "true" ] && echo 'ENABLED' || echo 'DISABLED')"
```

### set

Update an instance-level config value:

```bash
[ -z "$key" ] && { echo "ERROR: --key required."; exit 1; }
[ -z "$value" ] && { echo "ERROR: --value required."; exit 1; }

tmp="${instanceFile}.tmp"
case "$key" in
  scheduler.enabled)
    jq --argjson v "$([ "$value" = "true" ] && echo true || echo false)" '.scheduler.enabled = $v' "$instanceFile" > "$tmp" ;;
  scheduler.default_heartbeat_interval)
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "ERROR: value must be integer seconds."; exit 1; }
    jq --argjson v "$value" '.scheduler.default_heartbeat_interval = $v' "$instanceFile" > "$tmp" ;;
  scheduler.max_concurrent_heartbeats)
    [[ "$value" =~ ^[0-9]+$ ]] || { echo "ERROR: value must be integer."; exit 1; }
    jq --argjson v "$value" '.scheduler.max_concurrent_heartbeats = $v' "$instanceFile" > "$tmp" ;;
  limits.max_orgs)
    jq --argjson v "$value" '.limits.max_orgs = $v' "$instanceFile" > "$tmp" ;;
  limits.max_tokens_per_day)
    jq --argjson v "$value" '.limits.max_tokens_per_day = $v' "$instanceFile" > "$tmp" ;;
  *)
    echo "ERROR: Unknown key '$key'. Valid keys: scheduler.enabled, scheduler.default_heartbeat_interval, scheduler.max_concurrent_heartbeats, limits.max_orgs, limits.max_tokens_per_day"
    exit 1 ;;
esac
mv "$tmp" "$instanceFile"
echo "Set: $key = $value"
```

### health

Cross-org health overview:

```bash
echo "INSTANCE HEALTH"
echo "────────────────────────────────────────────────────────"
total_orgs=0
total_running=0
total_alerts=0
total_pending=0

for orgF in .monomind/orgs/*.json; do
  [[ "$orgF" == *-state* || "$orgF" == *-goals* || "$orgF" == *-routines* || "$orgF" == *-approvals* ]] && continue
  [[ "$orgF" == *-projects* || "$orgF" == *-worktrees* || "$orgF" == *-members* || "$orgF" == *-adapters* ]] && continue
  [[ "$orgF" == *-plugins* || "$orgF" == *-bootstrap* || "$orgF" == *-activity* ]] && continue
  [[ "$orgF" == *-issues* || "$orgF" == *-workspaces* || "$orgF" == *-environments* ]] && continue

  orgName=$(basename "$orgF" .json)
  total_orgs=$((total_orgs + 1))
  stateFile=".monomind/orgs/${orgName}-state.json"
  approvalsFile=".monomind/orgs/${orgName}-approvals.json"

  if [ -f "$stateFile" ]; then
    running=$(jq '[.agents // {} | to_entries[] | select(.value.status == "running")] | length' "$stateFile" 2>/dev/null || echo 0)
    total_running=$((total_running + running))
  fi
  if [ -f "$approvalsFile" ]; then
    pending=$(jq '[(.approvals // [])[] | select(.status == "pending")] | length' "$approvalsFile" 2>/dev/null || echo 0)
    total_pending=$((total_pending + pending))
  fi
done

echo "  Total orgs:       $total_orgs"
echo "  Running agents:   $total_running"
echo "  Pending approvals:$total_pending"
echo ""
[ "$total_running" -gt 0 ] && echo "  ✓ System is active." || echo "  ◌ No agents running."
[ "$total_pending" -gt 0 ] && echo "  ⚠ $total_pending approval(s) need attention. Run /mastermind:inbox."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
total_orgs: <N>
scheduler_enabled: <true|false>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
