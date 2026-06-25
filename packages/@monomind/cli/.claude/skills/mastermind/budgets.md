---
name: mastermind-budgets
description: Mastermind budgets — view, set, and track token/cost budgets for agents and the entire org. Shows current spend vs. limits, alerts on overages, and lets board members adjust per-agent or org-wide budgets. Reads from -budgets.json org state files.
type: domain-skill
default_mode: auto
---

# Mastermind Budgets

This skill is invoked by `mastermind:budgets` or directly via `/mastermind:budgets`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to manage budgets for (required)
- `action`: show | set | reset | alert
- `agent_id`: scope to a specific agent (optional — omit for org-wide)
- `limit_tokens`: token limit to set (for set)
- `limit_usd`: USD cost limit to set (for set)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org and Budget File

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

budgetsFile=".monomind/orgs/${org_name}-budgets.json"
stateFile=".monomind/orgs/${org_name}-state.json"

if [ ! -f "$budgetsFile" ]; then
  echo '{"org_budget":{},"agent_budgets":{},"period":"monthly","currency":"USD"}' > "$budgetsFile"
fi
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "BUDGETS — $org_name"
echo "════════════════════════════════════════════════════════"

python3 - "$orgFile" "$budgetsFile" "$stateFile" "${agent_id:-}" <<'PYEOF'
import json, sys, os

orgData    = json.load(open(sys.argv[1]))
budgetData = json.load(open(sys.argv[2]))
statePath  = sys.argv[3]
agentFilter= sys.argv[4]

# Load heartbeat state for per-agent token usage
agentTokens = {}
if os.path.exists(statePath):
    try:
        state = json.load(open(statePath))
        for r in state.get("roles", []):
            rid = r.get("id","")
            agentTokens[rid] = {
                "tokensIn":  r.get("tokens_in", 0),
                "tokensOut": r.get("tokens_out", 0),
                "totalCostUsd": r.get("total_cost_usd", 0.0),
            }
    except: pass

orgBudget   = budgetData.get("org_budget", {})
agentBudgets= budgetData.get("agent_budgets", {})
period      = budgetData.get("period", "monthly")

print(f"  Period: {period}")
print()

# Org-wide budget
orgLimitTokens = orgBudget.get("limit_tokens")
orgLimitUsd    = orgBudget.get("limit_usd")
orgSpentTokens = sum(v.get("tokensIn",0) + v.get("tokensOut",0) for v in agentTokens.values())
orgSpentUsd    = sum(v.get("totalCostUsd",0) for v in agentTokens.values())

print("ORG BUDGET")
print("────────────────────────────────────────────────────────")
print(f"  Tokens spent:  {orgSpentTokens:>12,}")
if orgLimitTokens:
    pct = orgSpentTokens / orgLimitTokens * 100
    bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
    print(f"  Token limit:   {orgLimitTokens:>12,}  [{bar}] {pct:.1f}%")
print(f"  Cost (USD):    ${orgSpentUsd:>11.4f}")
if orgLimitUsd:
    pct = orgSpentUsd / orgLimitUsd * 100
    bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
    print(f"  Cost limit:    ${orgLimitUsd:>11.2f}    [{bar}] {pct:.1f}%")
print()

# Per-agent budgets
roles = orgData.get("roles", [])
if agentFilter:
    roles = [r for r in roles if r.get("id") == agentFilter]

print("AGENT BUDGETS")
print("────────────────────────────────────────────────────────")
print(f"  {'AGENT':<28} {'TOKENS IN':<12} {'TOKENS OUT':<12} {'COST USD':<12} {'LIMIT USD'}")
print("  " + "─" * 82)

for role in roles:
    rid   = role.get("id","?")
    title = role.get("title", rid)[:26]
    tok   = agentTokens.get(rid, {})
    tIn   = tok.get("tokensIn", 0)
    tOut  = tok.get("tokensOut", 0)
    cost  = tok.get("totalCostUsd", 0.0)
    lim   = agentBudgets.get(rid, {}).get("limit_usd")
    limStr= f"${lim:.2f}" if lim else "—"

    overBudget = lim and cost > lim
    flag = " ⚠ OVER" if overBudget else ""
    print(f"  {title:<28} {tIn:<12,} {tOut:<12,} ${cost:<11.4f} {limStr}{flag}")

if not roles:
    print("  (no agents)")
PYEOF

echo ""
echo "  Set limit: /mastermind:budgets --org $org_name --action set --agent-id <id> --limit-usd 5.00"
echo "  Reset:     /mastermind:budgets --org $org_name --action reset"
```

### set

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$budgetsFile" "${agent_id:-}" "${limit_tokens:-}" "${limit_usd:-}" "$ts" <<'PYEOF'
import json, sys

path, agentId, limitTok, limitUsd, ts = sys.argv[1:]

data = json.load(open(path))

if agentId:
    entry = data.setdefault("agent_budgets", {}).setdefault(agentId, {})
    if limitTok: entry["limit_tokens"] = int(limitTok)
    if limitUsd:  entry["limit_usd"] = float(limitUsd)
    entry["updatedAt"] = ts
    print(f"  Budget set for agent '{agentId}':")
    if limitTok: print(f"    Token limit: {int(limitTok):,}")
    if limitUsd:  print(f"    USD limit:   ${float(limitUsd):.2f}")
else:
    org = data.setdefault("org_budget", {})
    if limitTok: org["limit_tokens"] = int(limitTok)
    if limitUsd:  org["limit_usd"] = float(limitUsd)
    org["updatedAt"] = ts
    print(f"  Org-wide budget updated:")
    if limitTok: print(f"    Token limit: {int(limitTok):,}")
    if limitUsd:  print(f"    USD limit:   ${float(limitUsd):.2f}")

with open(path, "w") as f:
    json.dump(data, f, indent=2)
PYEOF
```

### reset

```bash
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo '{"org_budget":{},"agent_budgets":{},"period":"monthly","currency":"USD","resetAt":"'"$ts"'"}' > "$budgetsFile"
echo "  Budget counters reset for '$org_name'  ($ts)"
echo "  Note: resets limit configs too. Re-run --action set to restore limits."
```

### alert

Check for agents over their budget limits:

```bash
echo "BUDGET ALERTS — $org_name"
echo "────────────────────────────────────────────────────────"

python3 - "$orgFile" "$budgetsFile" "$stateFile" <<'PYEOF'
import json, sys, os

orgData    = json.load(open(sys.argv[1]))
budgetData = json.load(open(sys.argv[2]))
statePath  = sys.argv[3]

agentTokens = {}
if os.path.exists(statePath):
    try:
        state = json.load(open(statePath))
        for r in state.get("roles", []):
            rid = r.get("id","")
            agentTokens[rid] = r.get("total_cost_usd", 0.0)
    except: pass

agentBudgets = budgetData.get("agent_budgets", {})
alerts = []
for rid, ab in agentBudgets.items():
    lim = ab.get("limit_usd")
    spent = agentTokens.get(rid, 0.0)
    if lim and spent > lim:
        alerts.append((rid, spent, lim))

if not alerts:
    print("  ✓ All agents within budget.")
else:
    print(f"  ⚠ {len(alerts)} agent(s) over budget:")
    for rid, spent, lim in alerts:
        print(f"    {rid}: spent ${spent:.4f} / limit ${lim:.2f}")
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
