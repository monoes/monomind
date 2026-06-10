---
name: mastermind-orgs
description: Mastermind orgs — list all saved orgs with their status, schedule, and last/next run times. Shows stopped/active/paused state for scheduled orgs.
type: domain-skill
default_mode: auto
---

# Mastermind Orgs

This skill is invoked by `mastermind:orgs` or directly via `/mastermind:orgs`.

Lists all saved orgs from `.monomind/orgs/*.json`.

---

## Inputs

- `caller`: command | master (controls whether brain load runs here)

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — List Orgs

```bash
orgsDir=".monomind/orgs"
orgFiles=$(ls "$orgsDir"/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments')

if [ -z "$orgFiles" ]; then
  echo "No saved orgs found."
  echo "Create one: /mastermind:createorg <goal>"
  exit 0
fi
```

---

## Step 2 — Render Org Table

For each org file (skip state/approvals files), extract and display:

```bash
echo ""
printf "%-28s %-10s %-12s %-22s %-22s\n" "ORG" "STATUS" "SCHEDULE" "LAST RUN" "NEXT RUN"
printf "%-28s %-10s %-12s %-22s %-22s\n" "---" "------" "--------" "--------" "--------"

for f in $orgFiles; do
  name=$(jq -r '.name // "(unnamed)"' "$f" 2>/dev/null)
  goal=$(jq -r '.goal // ""' "$f" 2>/dev/null | cut -c1-55)
  status=$(jq -r '.status // "—"' "$f" 2>/dev/null)
  interval=$(jq -r 'if .loop.poll_interval_minutes then "\(.loop.poll_interval_minutes)m" else "manual" end' "$f" 2>/dev/null)
  last_run=$(jq -r '.loop.last_run // "—"' "$f" 2>/dev/null | sed 's/T/ /;s/Z//')
  next_run=$(jq -r '.loop.next_run // "—"' "$f" 2>/dev/null | sed 's/T/ /;s/Z//')
  
  # Status indicator — distinguish non-scheduled (manual) from scheduled loop states
  if [ "$interval" = "manual" ]; then
    indicator="■ persistent"
  else
    case "$status" in
      active)  indicator="● active" ;;
      stopped) indicator="○ stopped" ;;
      paused)  indicator="⏸ paused" ;;
      *)       indicator="— unknown" ;;
    esac
  fi
  
  printf "%-28s %-10s %-12s %-22s %-22s\n" "$name" "$indicator" "$interval" "$last_run" "$next_run"
  echo "  └ $goal"
  echo ""
done
```

---

## Step 3 — Show Summary and Commands

```
COMMANDS
────────
  /mastermind:orgstatus --org <name>     Detailed status, last runs, activity
  /mastermind:runorg --org <name>        Start (or restart) a scheduled org
  /mastermind:stoporg --org <name>       Stop a running scheduled org
  /mastermind:createorg <goal>           Create a new org
```

---

## Step 4 — Return Output

```yaml
domain: ops
status: complete
```
