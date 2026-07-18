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
  echo "Available: $(ls .monomind/orgs/*.json 2>/dev/null | grep -vE -- '-approvals|-state|-activity|-goals|-routines|-projects|-members|-issues|-workspaces|-worktrees|-environments|-plugins|-adapters|-bootstrap|-threads|-budgets|-project-workspaces|-approval-comments' | xargs -I{} basename {} .json | tr '\n' ' ')"
  exit 1
}
```

---

## Step 2 — Extract Fields

An org is **v2** (Org Runtime v2 — the default since 2026-07) when it has no
`.loop` block; its schedule is the top-level `schedule` field and its live state
is `.monomind/orgs/<name>/runtime.json`. Only legacy v1 orgs have `.loop`,
`topology`, `board_id`, or `agent_type` on roles.

```bash
name=$(jq -r '.name // "(unnamed)"' "$orgFile")
goal=$(jq -r '.goal // "(no goal set)"' "$orgFile")
status=$(jq -r '.status // "no-schedule"' "$orgFile")
role_count=$(jq '.roles | length' "$orgFile")
created_at=$(jq -r '.created_at // "-"' "$orgFile")

has_schedule=$(jq -r 'if .loop.poll_interval_minutes then "yes" else "no" end' "$orgFile")

# v2 fields
is_v2=$([ "$has_schedule" = "no" ] && echo yes || echo no)
v2_schedule=$(jq -r '.schedule // empty' "$orgFile")
budget=$(jq -r '.run_config.budget_tokens // 1000000' "$orgFile")

# LEGACY-ORG-V1: remove this block when v1 orgs are gone
# v1 loop fields (legacy scheduled orgs only)
poll_interval=$(jq -r '.loop.poll_interval_minutes // ""' "$orgFile")
last_run=$(jq -r '.loop.last_run // "never"' "$orgFile")
next_run=$(jq -r '.loop.next_run // "not scheduled"' "$orgFile")
run_prompt_file=$(jq -r '.loop.run_prompt_file // ""' "$orgFile")
# end LEGACY-ORG-V1 loop-fields block

rtFile=".monomind/orgs/${org_name}/runtime.json"
rt_status=$(jq -r '.status // "never run"' "$rtFile" 2>/dev/null || echo "never run")
rt_run=$(jq -r '.run // ""' "$rtFile" 2>/dev/null || echo "")
rt_pid=$(jq -r '.pid // 0' "$rtFile" 2>/dev/null || echo 0)
rt_updated=$(jq -r '.updated // "-"' "$rtFile" 2>/dev/null || echo "-")
if [ "$rt_status" = "running" ] && [ "$rt_pid" -gt 0 ] && ! kill -0 "$rt_pid" 2>/dev/null; then
  rt_status="crashed (stale runtime.json, pid ${rt_pid} gone)"
fi
```

---

## Step 3 — Render Status

```bash
echo ""
echo "ORG: $name"
echo "════════════════════════════════════════════════"
echo "  Goal:      $goal"
echo "  Created:   $created_at"
echo "  Roles:     $role_count"
echo ""

if [ "$is_v2" = "yes" ]; then
  echo "RUNTIME (Org Runtime v2)"
  echo "────────────────────────"
  echo "  Status:    $rt_status${rt_run:+  (run $rt_run)}"
  echo "  Updated:   $rt_updated"
  echo "  Schedule:  ${v2_schedule:-manual — run with: monomind org run $name}"
  echo "  Budget:    $budget tokens (split across roles)"
  echo ""
fi

# LEGACY-ORG-V1: remove this block when v1 orgs are gone
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
jq -r '(.roles // [])[] | "  • [\(.id)] \(.title // .id)  →  \(.agent_type // .type // "specialist")  (reports to: \(.reports_to // "top"))"' "$orgFile"
echo ""

echo "HEALTH"
echo "──────"

if [ "$is_v2" = "yes" ]; then
  # v2 health = does the config still start? (schema + structural invariants)
  npx -y monomind@latest org validate "$name" >/dev/null 2>&1 \
    && echo "  Config:    ✓ valid (monomind org validate)" \
    || echo "  Config:    ✗ INVALID — run: monomind org validate $name"
else
  # LEGACY-ORG-V1: remove this branch when v1 orgs are gone
  # v1 health: board / column IDs
  board_id=$(jq -r '.board_id // ""' "$orgFile")
  todo_col=$(jq -r '.todo_col_id // ""' "$orgFile")
  doing_col=$(jq -r '.doing_col_id // ""' "$orgFile")
  done_col=$(jq -r '.done_col_id // ""' "$orgFile")
  if [ -n "$board_id" ] && [ -n "$todo_col" ] && [ -n "$doing_col" ] && [ -n "$done_col" ]; then
    echo "  Board:     ✓ task board configured (${board_id})"
  else
    echo "  Board:     ✗ task board IDs missing — re-run /mastermind:createorg --name ${name} to rebuild"
  fi
fi

# LEGACY-ORG-V1: remove this branch when v1 orgs are gone
# Pending approvals
approvalsFile=".monomind/orgs/${org_name}-approvals.json"
if [ -f "$approvalsFile" ]; then
  pending=$(jq '(.approvals // []) | map(select(.status == "pending")) | length' "$approvalsFile")
  [ "$pending" -gt 0 ] \
    && echo "  Approvals: ⚠ ${pending} pending — /mastermind:approvev1 --org ${name} --action list" \
    || echo "  Approvals: ✓ none pending"
else
  echo "  Approvals: ✓ no approvals file"
fi

# Stop file (pending stop signal) — v2 daemons poll <org>/stop; v1 used .stops/
[ -f ".monomind/orgs/${org_name}/stop" ] && echo "  Stop file: ⚠ PRESENT (v2) — daemon will exit within 2s of seeing it"
# LEGACY-ORG-V1: remove this check when v1 orgs are gone
[ -f ".monomind/orgs/.stops/${org_name}.stop" ] && echo "  Stop file: ⚠ PRESENT (v1 legacy path)"

# LEGACY-ORG-V1: remove this block when v1 orgs are gone
# Loop prompt file (scheduled orgs)
if [ "$has_schedule" = "yes" ]; then
  if [ -n "$run_prompt_file" ] && [ -f "$run_prompt_file" ]; then
    echo "  Loop prompt: ✓ exists (${run_prompt_file})"
  else
    echo "  Loop prompt: ✗ MISSING — scheduled org cannot self-perpetuate; re-create org or write prompt to ${run_prompt_file}"
  fi
fi
echo ""
```

---

## Step 4 — Show Recent Activity (if available)

```bash
if [ "$is_v2" = "yes" ]; then
  # v2: the durable record is bus.jsonl inside the most recent run directory
  latest_bus=$(ls -t .monomind/orgs/"${org_name}"/run-*/bus.jsonl 2>/dev/null | head -1)
  if [ -n "$latest_bus" ]; then
    echo "RECENT ACTIVITY (last 5 bus events — $(dirname "$latest_bus" | xargs basename))"
    echo "────────────────────────"
    tail -5 "$latest_bus" | while IFS= read -r line; do
      echo "$line" | jq -r '"  \(.ts // "" | if type=="number" then (./1000 | todate) else . end)  \(.type // "")  \(.from // "")\(if .to then " → " + .to else "" end)  \(.msg // .tool // "" | tostring | .[0:60])"' 2>/dev/null
    done
    echo ""
  fi
else
  # LEGACY-ORG-V1: remove this branch when v1 orgs are gone
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
fi
```

---

## Step 5 — Show Lifecycle Commands

```bash
echo "ACTIONS"
echo "───────"
if [ "$is_v2" = "yes" ]; then
  case "$rt_status" in
    running*) echo "  Stop:         monomind org stop $name" ;;
    crashed*) echo "  Close out:    monomind org mark-complete $name" ;;
    *)        echo "  Run:          monomind org run $name${v2_schedule:+   (or host on schedule: monomind org serve)}" ;;
  esac
  echo "  Logs:         monomind org logs $name --follow"
  echo "  Report:       monomind org report $name   (add --all for run history)"
  echo "  Validate:     monomind org validate $name"
  echo "  Settings:     /mastermind:org-settings --org $name"
# LEGACY-ORG-V1: remove the next two branches when v1 orgs are gone
elif [ "$has_schedule" = "yes" ]; then
  case "$status" in
    active|paused) echo "  Stop loop:    /mastermind:stoporg --org $name" ;;
    stopped)       echo "  Start loop:   /mastermind:runorg --org $name  (v1 config — will auto-migrate)" ;;
  esac
  echo "  Edit prompt:  \$EDITOR $run_prompt_file"
else
  echo "  Run org:      /mastermind:runorg --org $name  (v1 config — will auto-migrate)"
fi
echo "  All orgs:     /mastermind:orgs"
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
