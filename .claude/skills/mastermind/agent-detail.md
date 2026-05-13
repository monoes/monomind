---
name: mastermind-agent-detail
description: Mastermind agent-detail — deep per-agent inspection: show config, run history, budget usage, heartbeat status, assigned skills, and reset/reconfigure a single agent within an org.
type: domain-skill
default_mode: auto
---

# Mastermind Agent Detail

This skill is invoked by `mastermind:agent-detail` or directly via `/mastermind:agent-detail`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org the agent belongs to (required)
- `agent_id`: agent slug/id (required)
- `action`: show | runs | config | budget | heartbeat | skills | reset
- `days`: lookback window for run history (default 7)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Agent Data

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

agentDef=$(jq -r --arg id "$agent_id" '.roles[] | select(.id == $id)' "$orgFile")
[ -z "$agentDef" ] && { echo "ERROR: Agent '$agent_id' not found in org '$org_name'."; exit 1; }

stateFile=".monomind/orgs/${org_name}-state.json"
agentState="{}"
[ -f "$stateFile" ] && agentState=$(jq -r --arg id "$agent_id" '.agents[$id] // {}' "$stateFile")

activityFile=".monomind/orgs/${org_name}-activity.jsonl"
days=${days:-7}
cutoff=$(date -u -v-${days}d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "${days} days ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "")
```

---

## Step 2 — Execute Action

### show (default)

```bash
echo "AGENT DETAIL — $agent_id @ $org_name"
echo "────────────────────────────────────────────────────────"

echo "$agentDef" | jq -r '
  "  ID:          \(.id)",
  "  Title:       \(.title // "-")",
  "  Reports to:  \(.reports_to // "(top)")",
  "  Governance:  \(.governance // "inherit")",
  "  Model:       \(.adapter.model // "default")",
  "  Max tokens:  \((.adapter.max_tokens // 8192) | tostring)",
  "  Heartbeat:   \(if (.heartbeat.enabled // false) then "enabled (" + ((.heartbeat.interval // 900) | tostring) + "s)" else "disabled" end)"
'

status=$(echo "$agentState" | jq -r '.status // "unknown"')
lastRun=$(echo "$agentState" | jq -r '.last_run // "-"')
totalRuns=$(echo "$agentState" | jq -r '.total_runs // 0')
tokenUsed=$(echo "$agentState" | jq -r '.tokens_used // 0')

echo ""
echo "  Status:      $status"
echo "  Last run:    $lastRun"
echo "  Total runs:  $totalRuns"
echo "  Tokens used: $tokenUsed"

# Skills
skillCount=$(echo "$agentDef" | jq -r '(.skills // []) | length')
echo ""
echo "  Skills: $skillCount assigned"
echo "$agentDef" | jq -r '(.skills // [])[] | "    · \(.)"'
```

### runs

```bash
echo "RUN HISTORY — $agent_id (last ${days} days)"
echo "────────────────────────────────────────────────────────"
printf "%-26s %-10s %-8s %-12s %s\n" "TIMESTAMP" "STATUS" "TOKENS" "DURATION" "TASK"
echo "────────────────────────────────────────────────────────"

found=0
if [ -f "$activityFile" ]; then
  while IFS= read -r line; do
    agId=$(echo "$line" | jq -r '.agent // ""')
    [ "$agId" != "$agent_id" ] && continue
    ts=$(echo "$line" | jq -r '.ts // ""')
    [ -n "$cutoff" ] && [ "$ts" \< "$cutoff" ] && continue
    st=$(echo "$line" | jq -r '.status // "-"')
    tok=$(echo "$line" | jq -r '.tokens // "-"')
    dur=$(echo "$line" | jq -r '.duration_ms // "-"')
    task=$(echo "$line" | jq -r '.task // "-"' | cut -c1-40)
    printf "%-26s %-10s %-8s %-12s %s\n" "$ts" "$st" "$tok" "${dur}ms" "$task"
    found=$((found + 1))
  done < "$activityFile"
fi

[ "$found" -eq 0 ] && echo "  No runs in the last $days days."

# 7-day summary bar
echo ""
echo "ACTIVITY SUMMARY (last 7 days)"
for d in 6 5 4 3 2 1 0; do
  dayLabel=$(date -u -v-${d}d +%Y-%m-%d 2>/dev/null || date -u -d "${d} days ago" +%Y-%m-%d 2>/dev/null || echo "?")
  count=0
  if [ -f "$activityFile" ]; then
    count=$(grep "\"agent\":\"${agent_id}\"" "$activityFile" | grep "\"$dayLabel" | wc -l | tr -d ' ')
  fi
  bar=$(printf '%0.s█' $(seq 1 $((count > 10 ? 10 : count))))
  printf "  %s  %-10s %s\n" "$dayLabel" "$bar" "($count)"
done
```

### config

```bash
echo "ADAPTER CONFIG — $agent_id"
echo "────────────────────────────────────────────────────────"
echo "$agentDef" | jq '.adapter // {"model":"default","max_tokens":8192}'
echo ""
echo "RUNTIME CONFIG"
echo "$agentDef" | jq '.runtimeConfig // {}'
echo ""
echo "HEARTBEAT CONFIG"
echo "$agentDef" | jq '.heartbeat // {"enabled":false}'
```

### budget

```bash
echo "BUDGET — $agent_id @ $org_name"
echo "────────────────────────────────────────────────────────"

orgBudget=$(jq -r '.budget_tokens // 0' "$orgFile")
agentBudget=$(echo "$agentDef" | jq -r '.budget_tokens // null')
tokensUsed=$(echo "$agentState" | jq -r '.tokens_used // 0')

echo "  Org budget:     $orgBudget tokens/day"
[ "$agentBudget" != "null" ] && echo "  Agent cap:      $agentBudget tokens" || echo "  Agent cap:      (inherits org)"
echo "  Used today:     $tokensUsed tokens"

if [ "$orgBudget" -gt 0 ] && [ "$tokensUsed" -gt 0 ]; then
  pct=$((tokensUsed * 100 / orgBudget))
  echo "  Utilization:    ${pct}%"
  [ "$pct" -ge 80 ] && echo "  WARNING: Agent has used ${pct}% of org daily budget."
fi

# Per-day breakdown from activity
echo ""
echo "DAILY USAGE (last 7 days)"
for d in 6 5 4 3 2 1 0; do
  dayLabel=$(date -u -v-${d}d +%Y-%m-%d 2>/dev/null || date -u -d "${d} days ago" +%Y-%m-%d 2>/dev/null || echo "?")
  dayTok=0
  if [ -f "$activityFile" ]; then
    dayTok=$(grep "\"agent\":\"${agent_id}\"" "$activityFile" | grep "\"$dayLabel" | \
      jq -rs '[.[].tokens // 0] | add // 0' 2>/dev/null || echo 0)
  fi
  printf "  %s  %s tokens\n" "$dayLabel" "$dayTok"
done
```

### heartbeat

```bash
echo "HEARTBEAT CONFIG — $agent_id"
echo "────────────────────────────────────────────────────────"
enabled=$(echo "$agentDef" | jq -r '.heartbeat.enabled // false')
interval=$(echo "$agentDef" | jq -r '.heartbeat.interval // 900')
lastHb=$(echo "$agentState" | jq -r '.last_heartbeat // "-"')

echo "  Enabled:   $enabled"
echo "  Interval:  ${interval}s"
echo "  Last beat: $lastHb"
echo ""
echo "To toggle: /mastermind:instance --action toggle-heartbeat --org $org_name --agent-id $agent_id"
```

### skills

```bash
echo "SKILLS — $agent_id"
echo "────────────────────────────────────────────────────────"
skillList=$(echo "$agentDef" | jq -r '(.skills // [])[]' 2>/dev/null)

if [ -z "$skillList" ]; then
  echo "  No skills assigned. Use /mastermind:skills to map skills to this agent."
else
  while IFS= read -r sk; do
    skillFile=".claude/skills/${sk//:///}.md"
    [ -f "$skillFile" ] && desc=$(head -5 "$skillFile" | grep 'description:' | sed 's/description: //') || desc="(skill file not found)"
    printf "  %-30s %s\n" "$sk" "$desc"
  done <<< "$skillList"
fi
```

### reset

```bash
echo "Resetting agent state for '$agent_id'…"

tmp="${stateFile}.tmp"
if [ -f "$stateFile" ]; then
  jq --arg id "$agent_id" \
    '.agents[$id] = {"status":"idle","total_runs":0,"tokens_used":0,"last_run":null,"last_heartbeat":null}' \
    "$stateFile" > "$tmp" && mv "$tmp" "$stateFile"
fi

echo "Agent '$agent_id' state reset. Run history is preserved in activity log."
echo "To reconfigure adapter: edit the role in /mastermind:org --action show (then edit org config)."
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
agent_id: <agent_id>
agent_status: <status>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
