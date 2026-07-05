---
name: mastermind-costs
description: Mastermind costs — track token spend and budget burn rate per agent in a running org. Shows current window spend, budget policy, and alerts when approaching limits.
type: domain-skill
default_mode: auto
---

# Mastermind Costs

This skill is invoked by `mastermind:costs` or directly via `/mastermind:costs`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org to inspect costs for
- `action`: report | set-budget | alert
- `budget_tokens`: max token budget for the org run (for set-budget)
- `alert_threshold`: fraction of budget that triggers alert (default 0.8)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Cost Data

Cost data is pulled from monomind's token summary and the org state file:

```bash
orgFile=".monomind/orgs/${org_name}.json"
stateFile=".monomind/orgs/${org_name}-state.json"
tokenSummary=".monomind/metrics/token-summary.json"

memNs="org:${org_name}"
```

---

## Step 2 — Execute Action

### report (default)

Aggregate token usage per agent from state file and token summary:

```bash
# Get total token usage from the global summary for context
if [ -f "$tokenSummary" ]; then
  echo "=== GLOBAL TOKEN SUMMARY ==="
  jq -r '"Today: $\(.today.cost | tostring)  calls: \(.today.calls)"' "$tokenSummary" 2>/dev/null || true
fi

echo ""
echo "=== ORG SPEND — ${org_name} ==="

# Per-agent spend from state file
if [ -f "$stateFile" ]; then
  jq -r '.agents // {} | to_entries[] | "  \(.key):  tokens_in=\(.value.tokens_in // 0)  tokens_out=\(.value.tokens_out // 0)  status=\(.value.status // "unknown")"' "$stateFile" 2>/dev/null
else
  echo "  (no state file — org has not run yet)"
fi

# Budget check
budget=$(jq -r '.run_config.budget_tokens // "unlimited"' "$orgFile" 2>/dev/null)
echo ""
echo "Budget: $budget tokens"
```

Render as:
```
COSTS — org: <org_name>
──────────────────────────────────────────────
AGENT             STATUS    TOKENS IN    TOKENS OUT    EST. COST
boss              running   48,230       12,100        ~$0.42
content-writer    idle      21,400       8,900         ~$0.18
reviewer          waiting   5,100        2,300         ~$0.05
──────────────────────────────────────────────
TOTAL                        74,730       23,300        ~$0.65
BUDGET: 500,000 tokens  |  USED: 14.8%  |  REMAINING: 85.2%

BURN RATE: ~4,900 tokens/hour  |  EST. RUNWAY: ~87 hours
```

Calculate costs using approximate rates: input ~$3/1M tokens, output ~$15/1M tokens (Sonnet-class).

### set-budget

Write budget to org config:

```bash
tmp="${orgFile}.tmp"
jq --argjson budget "$budget_tokens" \
   --argjson threshold "${alert_threshold:-0.8}" \
   '.run_config.budget_tokens = $budget | .run_config.alert_threshold = $threshold' \
   "$orgFile" > "$tmp" && mv "$tmp" "$orgFile"
echo "Budget set: $budget_tokens tokens (alert at $(echo "$alert_threshold * 100" | bc)%)"
```

### alert

Check current usage against budget and emit alert if over threshold:

```bash
budget=$(jq -r '.run_config.budget_tokens // 0' "$orgFile")
threshold=$(jq -r '.run_config.alert_threshold // 0.8' "$orgFile")

if [ "$budget" -gt 0 ] && [ -f "$stateFile" ]; then
  total_in=$(jq '[.agents // {} | to_entries[] | .value.tokens_in // 0] | add // 0' "$stateFile")
  total_out=$(jq '[.agents // {} | to_entries[] | .value.tokens_out // 0] | add // 0' "$stateFile")
  total=$((total_in + total_out))
  
  # Use awk for float comparison
  over=$(awk -v total="$total" -v budget="$budget" -v threshold="$threshold" \
    'BEGIN { print (total/budget >= threshold) ? "yes" : "no" }')
  
  if [ "$over" = "yes" ]; then
    echo "ALERT: Org $org_name has used $(awk -v t=$total -v b=$budget 'BEGIN{printf "%.1f", t/b*100}')% of budget"
    REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
    CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
    curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
      -H "Content-Type: application/json" \
      -d "$(jq -cn --arg org "$org_name" --argjson total $total --argjson budget $budget \
        '{type:"org:budget:alert",org:$org,tokens_used:$total,budget:$budget,ts:(now*1000|floor)}')" || true
  fi
fi
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
total_tokens: <N>
budget_tokens: <N>
usage_pct: <N>%
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
