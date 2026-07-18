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

For each org file (skip state/approvals files), extract and display. v2 orgs
(Org Runtime v2, the default since 2026-07) carry `schedule` ("30m"/"2h") in the
config and their live state in `.monomind/orgs/<name>/runtime.json`; only legacy
v1 orgs have a `.loop` block.

```bash
echo ""
printf "%-28s %-14s %-12s %-22s\n" "ORG" "STATUS" "SCHEDULE" "LAST RUN"
printf "%-28s %-14s %-12s %-22s\n" "---" "------" "--------" "--------"

for f in $orgFiles; do
  name=$(basename "$f" .json)
  goal=$(jq -r '.goal // ""' "$f" 2>/dev/null | cut -c1-55)
  schedule=$(jq -r '.schedule // empty' "$f" 2>/dev/null)
  loop_interval=$(jq -r '.loop.poll_interval_minutes // empty' "$f" 2>/dev/null)

  if [ -n "$loop_interval" ]; then
    # legacy v1 scheduled org — state lives in the config's status field
    interval="${loop_interval}m (v1)"
    status=$(jq -r '.status // "—"' "$f" 2>/dev/null)
    case "$status" in
      active)  indicator="● active" ;;
      paused)  indicator="⏸ paused" ;;
      *)       indicator="○ stopped" ;;
    esac
    last_run=$(jq -r '.loop.last_run // "—"' "$f" 2>/dev/null | sed 's/T/ /;s/Z//')
  else
    # v2 org — live state is in runtime.json (crashed = running record, dead pid)
    interval="${schedule:-manual}"
    rt=".monomind/orgs/${name}/runtime.json"
    rt_status=$(jq -r '.status // "never run"' "$rt" 2>/dev/null || echo "never run")
    rt_pid=$(jq -r '.pid // 0' "$rt" 2>/dev/null || echo 0)
    if [ "$rt_status" = "running" ] && [ "$rt_pid" -gt 0 ] && ! kill -0 "$rt_pid" 2>/dev/null; then
      indicator="✗ crashed"
    elif [ "$rt_status" = "running" ]; then
      indicator="● running"
    elif [ "$rt_status" = "never run" ]; then
      indicator="· never run"
    else
      indicator="○ ${rt_status}"
    fi
    last_run=$(jq -r '.updated // "—"' "$rt" 2>/dev/null | sed 's/T/ /;s/\..*Z//' || echo "—")
  fi

  printf "%-28s %-14s %-12s %-22s\n" "$name" "$indicator" "$interval" "$last_run"
  echo "  └ $goal"
  echo ""
done
```

---

## Step 3 — Show Summary and Commands

```
COMMANDS
────────
  monomind org run <name>                Run an org once in the foreground
  monomind org serve                     Host all scheduled orgs as a daemon
  monomind org stop <name>               Stop a running org
  monomind org status [name]             Runtime state (detects crashes)
  monomind org validate [name]           Check config against the runtime schema
  /mastermind:orgstatus --org <name>     Detailed status, last runs, activity
  /mastermind:createorg <goal>           Create a new org
  /mastermind:runorg --org <name>        v2 delegator (auto-migrates v1 configs, then runs via the daemon)
```

---

## Step 4 — Return Output

```yaml
domain: ops
status: complete
```
