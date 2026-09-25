---
name: mastermind-orgstatus
description: Mastermind orgstatus — show detailed status for a single org including runtime state, schedule, config health, pending approvals, recent activity, and roles.
type: domain-skill
default_mode: auto
pick: low
---

# Mastermind Org Status

This skill is invoked by `mastermind:orgstatus` or directly via `/mastermind:orgstatus`.

---

## Inputs

- `org_name`: name of the org to inspect (required)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following mastermind-protocol/SKILL.md Brain Load Procedure with namespace: `ops`.

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

An org's schedule is the top-level `schedule` field and its live state is
`.monomind/orgs/<name>/runtime.json`. A config file that still carries
`topology`, `board_id`, `loop`, or `agent_type` on roles is in the legacy
format: `monomind org run` converts it in memory (with a deprecation warning),
and `monomind org migrate <name>` rewrites the file.

```bash
name=$(jq -r '.name // "(unnamed)"' "$orgFile")
goal=$(jq -r '.goal // "(no goal set)"' "$orgFile")
role_count=$(jq '.roles | length' "$orgFile")
created_at=$(jq -r '.created_at // "-"' "$orgFile")
schedule=$(jq -r '.schedule // empty' "$orgFile")
budget=$(jq -r '.run_config.budget_tokens // 1000000' "$orgFile")
legacy_format=$(jq -r 'if has("topology") or has("board_id") or has("loop") or ([.roles[]? | has("agent_type")] | any) then "yes" else "no" end' "$orgFile")

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

echo "RUNTIME"
echo "───────"
echo "  Status:    $rt_status${rt_run:+  (run $rt_run)}"
echo "  Updated:   $rt_updated"
echo "  Schedule:  ${schedule:-manual — run with: monomind org run $name}"
echo "  Budget:    $budget tokens (split across roles)"
echo ""

echo "ROLES"
echo "─────"
jq -r '(.roles // [])[] | "  • [\(.id)] \(.title // .id)  →  \(.type // .agent_type // "specialist")  (reports to: \(.reports_to // "top"))"' "$orgFile"
echo ""

echo "HEALTH"
echo "──────"
# health = does the config still start? (schema + structural invariants)
npx -y monomind@latest org validate "$name" >/dev/null 2>&1 \
  && echo "  Config:    ✓ valid (monomind org validate)" \
  || echo "  Config:    ✗ INVALID — run: monomind org validate $name"
[ "$legacy_format" = "yes" ] \
  && echo "  Format:    ⚠ legacy config format — convert with: monomind org migrate $name"

# Pending tool approvals (the runtime's queue: .monomind/orgs/<name>/approvals.json)
pending=$(jq '[(.approvals // [])[] | select(.approved == null)] | length' ".monomind/orgs/${org_name}/approvals.json" 2>/dev/null || echo 0)
[ "$pending" -gt 0 ] \
  && echo "  Approvals: ⚠ ${pending} pending — monomind org approvals ${name}" \
  || echo "  Approvals: ✓ none pending"

# Stop file (pending stop signal) — the daemon polls <org>/stop
[ -f ".monomind/orgs/${org_name}/stop" ] && echo "  Stop file: ⚠ PRESENT — daemon will exit within 2s of seeing it"
echo ""
```

---

## Step 4 — Show Recent Activity (if available)

```bash
# the durable record is bus.jsonl inside the most recent run directory
latest_bus=$(ls -t .monomind/orgs/"${org_name}"/run-*/bus.jsonl 2>/dev/null | head -1)
if [ -n "$latest_bus" ]; then
  echo "RECENT ACTIVITY (last 5 bus events — $(dirname "$latest_bus" | xargs basename))"
  echo "────────────────────────"
  tail -5 "$latest_bus" | while IFS= read -r line; do
    echo "$line" | jq -r '"  \(.ts // "" | if type=="number" then (./1000 | todate) else . end)  \(.type // "")  \(.from // "")\(if .to then " → " + .to else "" end)  \(.msg // .tool // "" | tostring | .[0:60])"' 2>/dev/null
  done
  echo ""
fi
```

---

## Step 5 — Show Lifecycle Commands

```bash
echo "ACTIONS"
echo "───────"
case "$rt_status" in
  running*) echo "  Stop:         monomind org stop $name" ;;
  crashed*) echo "  Close out:    monomind org mark-complete $name" ;;
  *)        echo "  Run:          monomind org run $name${schedule:+   (or host on schedule: monomind org serve)}" ;;
esac
echo "  Logs:         monomind org logs $name --follow"
echo "  Report:       monomind org report $name   (add --all for run history)"
echo "  Validate:     monomind org validate $name"
echo "  Settings:     /mastermind-org-settings --org $name"
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

If `caller` is not "command", follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.
