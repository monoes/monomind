---
name: mastermind-inbox
description: "Mastermind inbox — unified view of everything that needs human attention across all orgs: pending tool approvals, running orgs, active task assignments, and budget alerts. The single place to check before starting work."
type: domain-skill
default_mode: auto
pick: low
---

# Mastermind Inbox

This skill is invoked by `mastermind:inbox` or directly via `/mastermind-inbox`.

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

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

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
  approvalsFile=".monomind/orgs/${org}/approvals.json"
  rtFile=".monomind/orgs/${org}/runtime.json"

  # 1. Pending tool approvals (the runtime's queue — `monomind org approvals <org>`)
  if [ -f "$approvalsFile" ]; then
    pending=$(jq '[(.approvals // [])[] | select(.approved == null)] | length' "$approvalsFile" 2>/dev/null || echo 0)
    total_approvals=$((total_approvals + pending))
  fi

  # 2. Running orgs (runtime.json status "running" with a live pid)
  rt_pid=$(jq -r 'if .status == "running" then (.pid // 0) else 0 end' "$rtFile" 2>/dev/null || echo 0)
  if [ "$rt_pid" -gt 0 ] && kill -0 "$rt_pid" 2>/dev/null; then
    total_heartbeats=$((total_heartbeats + 1))
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
echo "  🟡 ORGS RUNNING:       $total_heartbeats"
echo "  🟠 BUDGET ALERTS:      $total_alerts"
echo ""

for org in $orgs; do
  orgFile=".monomind/orgs/${org}.json"
  stateFile=".monomind/orgs/${org}-state.json"
  approvalsFile=".monomind/orgs/${org}/approvals.json"
  rtFile=".monomind/orgs/${org}/runtime.json"

  has_items=0

  # Pending tool approvals
  if [ -f "$approvalsFile" ]; then
    pending_approvals=$(jq -r '(.approvals // [])[] | select(.approved == null) | "  [APPROVAL] \(.roleId): \(.action)\(if .requestId then "  [\(.requestId)]" else "" end)"' \
      "$approvalsFile" 2>/dev/null)
    [ -n "$pending_approvals" ] && { has_items=1; echo "ORG: $org"; echo "$pending_approvals"; }
  fi

  # Running org
  rt_pid=$(jq -r 'if .status == "running" then (.pid // 0) else 0 end' "$rtFile" 2>/dev/null || echo 0)
  if [ "$rt_pid" -gt 0 ] && kill -0 "$rt_pid" 2>/dev/null; then
    [ $has_items -eq 1 ] || echo "ORG: $org"
    has_items=1
    echo "  [RUNNING]  run=$(jq -r '.run // "?"' "$rtFile")  since=$(jq -r '.updated // "unknown"' "$rtFile")"
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
  [ -f ".monomind/orgs/${org}/approvals.json" ] || continue
  echo "=== $org ==="
  npx -y monomind@latest org approvals "$org"
  echo ""
done
```

### filter: heartbeats only

Show the orgs that are running now:

```bash
npx -y monomind@latest org status
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
# Approve or deny a pending tool request:
monomind org approve <org> <role> "<action>"
monomind org deny <org> <role> "<action>"

# Stop a running org:
monomind org stop <org>

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

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
