---
name: mastermind-orgstatus
description: Mastermind orgstatus — show detailed status for a single org including lifecycle state, schedule, last/next run, recent activity, and roles. For scheduled orgs shows loop health and time until next iteration.
type: domain-skill
default_mode: auto
---

# Mastermind Org Status

This skill is invoked by `mastermind:orgstatus` or directly via `/mastermind:orgstatus`.

---

## Inputs

- `org_name`: name of the org to inspect (required)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && {
  echo "ERROR: Org '${org_name}' not found."
  echo "Available: $(ls .monomind/orgs/*.json 2>/dev/null | grep -v -- '-approvals\|-state\|-activity' | xargs -I{} basename {} .json | tr '\n' ' ')"
  exit 1
}
```

---

## Step 2 — Extract Fields

```bash
name=$(jq -r '.name' "$orgFile")
goal=$(jq -r '.goal' "$orgFile")
status=$(jq -r '.status // "no-schedule"' "$orgFile")
topology=$(jq -r '.topology' "$orgFile")
role_count=$(jq '.roles | length' "$orgFile")
created_at=$(jq -r '.created_at' "$orgFile")

# Loop fields (scheduled orgs only)
has_schedule=$(jq 'if .loop.poll_interval_minutes then "yes" else "no" end' "$orgFile")
poll_interval=$(jq -r '.loop.poll_interval_minutes // ""' "$orgFile")
last_run=$(jq -r '.loop.last_run // "never"' "$orgFile")
next_run=$(jq -r '.loop.next_run // "not scheduled"' "$orgFile")
run_prompt_file=$(jq -r '.loop.run_prompt_file // ""' "$orgFile")
```

---

## Step 3 — Render Status

```bash
echo ""
echo "ORG: $name"
echo "════════════════════════════════════════════════"
echo "  Goal:      $goal"
echo "  Created:   $created_at"
echo "  Topology:  $topology  |  Roles: $role_count"
echo ""

if [ "$has_schedule" = "yes" ]; then
  echo "SCHEDULED LOOP"
  echo "──────────────"
  
  case "$status" in
    active)  echo "  Status:    ● ACTIVE — loop is running" ;;
    stopped) echo "  Status:    ○ STOPPED — loop is not running" ;;
    paused)  echo "  Status:    ⏸ PAUSED — loop is alive but skipping iterations (HIL gate)" ;;
    *)       echo "  Status:    ? $status" ;;
  esac
  
  echo "  Interval:  every ${poll_interval} minutes"
  echo "  Last run:  $last_run"
  echo "  Next run:  $next_run"
  echo "  Prompt:    $run_prompt_file"
  echo ""
fi

echo "ROLES"
echo "─────"
jq -r '.roles[] | "  • [\(.id)] \(.title)  →  \(.agent_type)  (\(.reports_to // "top"))"' "$orgFile"
echo ""
```

---

## Step 4 — Show Recent Activity (if available)

```bash
activityFile=".monomind/orgs/${org_name}-activity.jsonl"
if [ -f "$activityFile" ]; then
  echo "RECENT ACTIVITY (last 5)"
  echo "────────────────────────"
  tail -5 "$activityFile" | while IFS= read -r line; do
    ts=$(echo "$line" | jq -r '.ts // ""')
    type=$(echo "$line" | jq -r '.type // ""')
    pending=$(echo "$line" | jq -r '.pending // ""')
    echo "  $ts  $type  ${pending:+pending=$pending}"
  done
  echo ""
fi
```

---

## Step 5 — Show Lifecycle Commands

```bash
if [ "$has_schedule" = "yes" ]; then
  echo "ACTIONS"
  echo "───────"
  case "$status" in
    active|paused)
      echo "  Stop loop:    /mastermind:stoporg --org $name"
      ;;
    stopped)
      echo "  Start loop:   /mastermind:runorg --org $name"
      ;;
  esac
  echo "  Edit prompt:  \$EDITOR $run_prompt_file"
  echo "  All orgs:     /mastermind:orgs"
else
  echo "ACTIONS"
  echo "───────"
  echo "  Run org:      /mastermind:runorg --org $name"
  echo "  All orgs:     /mastermind:orgs"
fi
echo ""
```

---

## Step 6 — Return Output

```yaml
domain: ops
status: complete
```

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
