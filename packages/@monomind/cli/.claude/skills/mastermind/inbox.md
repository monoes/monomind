---
name: mastermind-inbox
description: Mastermind inbox — unified view of everything that needs human attention across all orgs: pending approvals, running heartbeats, active task assignments, and budget alerts. The single place to check before starting work.
type: domain-skill
default_mode: auto
---

# Mastermind Inbox

This skill is invoked by `mastermind:inbox` or directly via `/mastermind:inbox`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: optional — filter to a single org (default: all orgs)
- `filter`: all | approvals | heartbeats | tasks | alerts (default: all)
- `action`: read | mark-done | archive
- `item_id`: id of item to action
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Collect All Orgs

```bash
if [ -n "$org_name" ]; then
  orgs="$org_name"
else
  orgs=$(ls .monomind/orgs/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments' | xargs -I{} basename {} .json | sort)
fi
```

---

## Step 2 — Gather Inbox Items

For each org, collect:

```bash
total_approvals=0
total_heartbeats=0
total_alerts=0

for org in $orgs; do
  orgFile=".monomind/orgs/${org}.json"
  stateFile=".monomind/orgs/${org}-state.json"
  approvalsFile=".monomind/orgs/${org}-approvals.json"

  # 1. Pending approvals
  if [ -f "$approvalsFile" ]; then
    pending=$(jq '[(.approvals // [])[] | select(.status == "pending")] | length' "$approvalsFile" 2>/dev/null || echo 0)
    total_approvals=$((total_approvals + pending))
  fi

  # 2. Running agents (active heartbeats)
  if [ -f "$stateFile" ]; then
    running=$(jq '[.agents // {} | to_entries[] | select(.value.status == "running")] | length' "$stateFile" 2>/dev/null || echo 0)
    total_heartbeats=$((total_heartbeats + running))
  fi

  # 3. Budget alerts
  budget=$(jq -r '.run_config.budget_tokens // 0' "$orgFile" 2>/dev/null || echo 0)
  threshold=$(jq -r '.run_config.alert_threshold // 0.8' "$orgFile" 2>/dev/null || echo 0.8)
  if [ "$budget" -gt 0 ] && [ -f "$stateFile" ]; then
    total_in=$(jq '[.agents // {} | to_entries[] | .value.tokens_in // 0] | add // 0' "$stateFile" 2>/dev/null || echo 0)
    total_out=$(jq '[.agents // {} | to_entries[] | .value.tokens_out // 0] | add // 0' "$stateFile" 2>/dev/null || echo 0)
    total_tok=$((total_in + total_out))
    over=$(awk -v t="$total_tok" -v b="$budget" -v thr="$threshold" \
      'BEGIN { print (b>0 && t/b >= thr) ? "yes" : "no" }')
    [ "$over" = "yes" ] && total_alerts=$((total_alerts + 1))
  fi
done
```

---

## Step 3 — Render Inbox

```bash
echo "╔══════════════════════════════════════════════════════╗"
echo "║  MASTERMIND INBOX                                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  🔴 APPROVALS NEEDED:   $total_approvals"
echo "  🟡 AGENTS RUNNING:     $total_heartbeats"
echo "  🟠 BUDGET ALERTS:      $total_alerts"
echo ""

for org in $orgs; do
  orgFile=".monomind/orgs/${org}.json"
  stateFile=".monomind/orgs/${org}-state.json"
  approvalsFile=".monomind/orgs/${org}-approvals.json"

  has_items=0

  # Pending approvals
  if [ -f "$approvalsFile" ]; then
    pending_approvals=$(jq -r '(.approvals // [])[] | select(.status == "pending") | "  [APPROVAL] [\(.id)] \(.agent_id): \(.title)  risk=\(.risk_level // "low")"' \
      "$approvalsFile" 2>/dev/null)
    [ -n "$pending_approvals" ] && { has_items=1; echo "ORG: $org"; echo "$pending_approvals"; }
  fi

  # Running agents
  if [ -f "$stateFile" ]; then
    running_agents=$(jq -r '
      .agents // {} | to_entries[] | select(.value.status == "running") |
      "  [RUNNING]  [\(.key)]  since=\(.value.last_heartbeat // "unknown")"
    ' "$stateFile" 2>/dev/null)
    [ -n "$running_agents" ] && { has_items=1; [ $has_items -eq 1 ] || echo "ORG: $org"; echo "$running_agents"; }
  fi

  [ $has_items -eq 1 ] && echo ""
done

if [ "$total_approvals" -eq 0 ] && [ "$total_heartbeats" -eq 0 ] && [ "$total_alerts" -eq 0 ]; then
  echo "  ✓ Inbox is clear. No items need attention."
fi
```

### filter: approvals only

```bash
for org in $orgs; do
  approvalsFile=".monomind/orgs/${org}-approvals.json"
  [ -f "$approvalsFile" ] || continue
  echo "=== $org ==="
  jq -r '(.approvals // [])[] | select(.status == "pending") |
    "[\(.id)] \(.agent_id): \(.title)\n  Action: \(.action)\n  Risk: \(.risk_level // "low")\n  → /mastermind:approve --org '"$org"' --action approve --approval-id \(.id)"
  ' "$approvalsFile" 2>/dev/null || echo "  No pending approvals."
  echo ""
done
```

### filter: heartbeats only

Show currently running agent heartbeats across all orgs:

```bash
for org in $orgs; do
  stateFile=".monomind/orgs/${org}-state.json"
  [ -f "$stateFile" ] || continue
  running=$(jq -r '
    .agents // {} | to_entries[] | select(.value.status == "running") |
    "  [\(.key)] since=\(.value.last_heartbeat // "?")"
  ' "$stateFile" 2>/dev/null)
  [ -n "$running" ] && { echo "=== $org ==="; echo "$running"; echo ""; }
done
```

### filter: alerts only

```bash
echo "BUDGET ALERTS:"
for org in $orgs; do
  orgFile=".monomind/orgs/${org}.json"
  stateFile=".monomind/orgs/${org}-state.json"
  budget=$(jq -r '.run_config.budget_tokens // 0' "$orgFile" 2>/dev/null || echo 0)
  [ "$budget" -le 0 ] && continue
  [ -f "$stateFile" ] || continue
  total_in=$(jq '[.agents // {} | to_entries[] | .value.tokens_in // 0] | add // 0' "$stateFile" 2>/dev/null || echo 0)
  total_out=$(jq '[.agents // {} | to_entries[] | .value.tokens_out // 0] | add // 0' "$stateFile" 2>/dev/null || echo 0)
  total_tok=$((total_in + total_out))
  pct=$(awk -v t="$total_tok" -v b="$budget" 'BEGIN{printf "%.1f", t/b*100}')
  echo "  $org: ${pct}% of $budget token budget used"
done
```

---

## Quick Action Shortcuts

From the inbox, the user can directly:

```bash
# Approve a pending request:
/mastermind:approve --org <org> --action approve --approval-id <id>

# Stop a running agent:
/mastermind:agents --org <org> --action pause --agent-id <id>

# Check costs:
/mastermind:costs --org <org> --action report

# Set budget:
/mastermind:costs --org <org> --action set-budget --budget-tokens 500000
```

---

## Step 4 — Return Output

```yaml
domain: ops
status: complete
filter: <filter>
orgs_checked: <N>
pending_approvals: <N>
running_heartbeats: <N>
budget_alerts: <N>
```

---

## Step 5 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
