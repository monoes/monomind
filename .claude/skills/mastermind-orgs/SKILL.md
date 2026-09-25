---
name: mastermind-orgs
description: Mastermind orgs — list all saved orgs with their runtime status, schedule, and last run time. Flags crashed runs and config files still in the legacy format.
type: domain-skill
default_mode: auto
pick: low
---

# Mastermind Orgs

This skill is invoked by `mastermind:orgs` or directly via `/mastermind:orgs`.

Lists all saved orgs from `.monomind/orgs/*.json`.

---

## Inputs

- `caller`: command | master (controls whether brain load runs here)

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

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

For each org file (skip state/approvals files), extract and display. An org
carries `schedule` ("30m"/"2h") in the config and its live state in
`.monomind/orgs/<name>/runtime.json`. A config file with a `.loop` block is in
the legacy format — `monomind org run` converts it in memory (its
`loop.poll_interval_minutes` becomes the schedule), and `monomind org migrate
<name>` rewrites the file.

```bash
echo ""
printf "%-28s %-14s %-12s %-22s\n" "ORG" "STATUS" "SCHEDULE" "LAST RUN"
printf "%-28s %-14s %-12s %-22s\n" "---" "------" "--------" "--------"

for f in $orgFiles; do
  name=$(basename "$f" .json)
  goal=$(jq -r '.goal // ""' "$f" 2>/dev/null | cut -c1-55)
  schedule=$(jq -r '.schedule // empty' "$f" 2>/dev/null)
  loop_interval=$(jq -r '.loop.poll_interval_minutes // empty' "$f" 2>/dev/null)

  # legacy-format config: the runtime turns loop.poll_interval_minutes into the schedule
  [ -z "$schedule" ] && [ -n "$loop_interval" ] && schedule="${loop_interval}m"
  interval="${schedule:-manual}"
  [ -n "$loop_interval" ] && interval="${interval} (legacy)"

  # live state is in runtime.json (crashed = running record, dead pid)
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
  /mastermind:runorg --org <name>        Validate and start an org (converts legacy-format configs first)
  monomind org migrate <name>            Convert a legacy-format config file
```

---

## Step 4 — Return Output

```yaml
domain: ops
status: complete
```
