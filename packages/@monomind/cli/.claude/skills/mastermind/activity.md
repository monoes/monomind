---
name: mastermind-activity
description: Mastermind activity — full activity feed for an org with event-type filtering, actor lookups, and entity name resolution. Fetches up to 200 recent events across issue, project, goal, agent, and routine entity types. Mirrors Activity.tsx.
type: domain-skill
default_mode: auto
---

# Mastermind Activity

This skill is invoked by `mastermind:activity` or directly via `/mastermind:activity`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to query (required)
- `action`: list | filter | export | stats
- `entity_type`: issue | project | goal | agent | routine | all (default: all)
- `actor_id`: filter by agent or user id (optional)
- `limit`: max events to show (default: 50, max: 200)
- `since`: ISO timestamp — show events after this time (optional)
- `output_file`: file path to export JSONL (for export action)
- `caller`: command | master

---

## Event Entity Types

| Type | Description |
|------|-------------|
| `issue` | Issue created, status changed, assigned, closed |
| `project` | Project created, updated, archived |
| `goal` | Goal created, progress updated, closed |
| `agent` | Agent started, stopped, errored, completed |
| `routine` | Routine triggered, run started, run completed |
| `approval` | Approval requested, approved, rejected |
| `workspace` | Workspace provisioned, teardown |

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Activity Log

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

activityFile=".monomind/orgs/${org_name}-activity.jsonl"
limit="${limit:-50}"
entityType="${entity_type:-all}"
```

---

## Step 2 — Execute Action

### list (default)

```bash
echo "ACTIVITY — org: $org_name"
echo "  Filter: type=${entityType}  limit=${limit}${actor_id:+  actor=${actor_id}}${since:+  since=${since}}"
echo "────────────────────────────────────────────────────────"
printf "%-20s %-12s %-14s %-24s %s\n" "TIMESTAMP" "ENTITY TYPE" "ACTOR" "ENTITY" "EVENT"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$activityFile" ]; then
  # Fall back to mastermind-events.jsonl
  eventSrc="data/mastermind-events.jsonl"
  if [ ! -f "$eventSrc" ]; then
    echo "  No activity log found. Activity is written when agents run."
    exit 0
  fi
  activityFile="$eventSrc"
fi

tail -${limit} "$activityFile" | while IFS= read -r line; do
  et=$(echo "$line" | jq -r '.entityType // .type // "unknown"')
  actor=$(echo "$line" | jq -r '.actorId // .actor // "-"' | cut -c1-12)
  entity=$(echo "$line" | jq -r '(.entityId // .entity // "-")' | cut -c1-22)
  event=$(echo "$line" | jq -r '.event // .action // .type // "-"')
  ts=$(echo "$line" | jq -r '.ts // .timestamp // .createdAt // "-"' | cut -c1-19)

  # Apply filters
  [ "$entityType" != "all" ] && [ "$et" != "$entityType" ] && continue
  [ -n "$actor_id" ] && [ "$actor" != "$actor_id" ] && continue
  [ -n "$since" ] && [ "$ts" \< "$since" ] && continue

  printf "%-20s %-12s %-14s %-24s %s\n" "$ts" "$et" "$actor" "$entity" "$event"
done

echo ""
echo "  Showing last $limit events. Use --limit N for more (max 200)."
```

### filter

```bash
echo "ACTIVITY FILTER — org: $org_name  type=$entityType"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$activityFile" ]; then
  echo "  No activity log found."
  exit 0
fi

# Show available entity types in the log
echo "AVAILABLE ENTITY TYPES IN LOG:"
tail -200 "$activityFile" | jq -r '.entityType // .type // "unknown"' 2>/dev/null | sort | uniq -c | sort -rn | while read -r cnt et; do
  printf "  %-20s %d events\n" "$et" "$cnt"
done

echo ""
echo "  Filter: /mastermind:activity --org $org_name --action list --entity-type <type>"
```

### stats

```bash
echo "ACTIVITY STATS — org: $org_name"
echo "────────────────────────────────────────────────────────"

if [ ! -f "$activityFile" ]; then
  echo "  No activity log found."
  exit 0
fi

total=$(wc -l < "$activityFile" | tr -d ' ')
echo "  Total events: $total"
echo ""

echo "BY ENTITY TYPE:"
tail -200 "$activityFile" | jq -r '.entityType // .type // "unknown"' 2>/dev/null | sort | uniq -c | sort -rn | \
  while read -r cnt et; do printf "  %-20s %d\n" "$et" "$cnt"; done

echo ""
echo "BY ACTOR (top 5):"
tail -200 "$activityFile" | jq -r '.actorId // .actor // "-"' 2>/dev/null | sort | uniq -c | sort -rn | head -5 | \
  while read -r cnt actor; do printf "  %-28s %d\n" "$actor" "$cnt"; done

# Last 24h
cutoff=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u --date="24 hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)
last24=$(tail -200 "$activityFile" | jq -r --arg c "$cutoff" 'select((.ts // .timestamp // .createdAt // "") >= $c) | .entityType' 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo "  Events in last 24h: $last24"
```

### export

```bash
outFile="${output_file:-.monomind/exports/${org_name}-activity-$(date +%Y%m%d%H%M%S).jsonl}"
mkdir -p "$(dirname "$outFile")"

if [ ! -f "$activityFile" ]; then
  echo "  No activity log to export."
  exit 0
fi

if [ "$entityType" != "all" ]; then
  jq -r --arg et "$entityType" 'select(.entityType == $et or .type == $et)' "$activityFile" > "$outFile"
else
  cp "$activityFile" "$outFile"
fi

lines=$(wc -l < "$outFile" | tr -d ' ')
echo "Activity exported: $outFile  ($lines events)"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org: <org_name>
entity_type: <entity_type>
events_shown: <N>
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
