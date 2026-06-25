---
name: mastermind-diagnose
description: Mastermind diagnose — forensic procedure for investigating why agent work stalled, looped, or went too deep. Surfaces the exact stop-point in the issue tree, frames the fix as a product rule respecting three invariants (productive work continues / only real blockers stop work / no infinite loops), and delivers an approved plan before any code changes. Mirrors diagnose-why-work-stopped Paperclip skill.
type: domain-skill
default_mode: confirm
---

# Mastermind Diagnose

This skill is invoked by `mastermind:diagnose` or directly via `/mastermind:diagnose`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org to investigate (required)
- `issue_id`: specific issue or task ID that stalled (optional — omit to scan all stalled work)
- `agent_id`: scope investigation to a specific agent (optional)
- `action`: scan | diagnose | report
- `caller`: command | master

---

## Three Invariants (MUST be preserved in all analysis and proposed fixes)

Every diagnosis and every proposed rule must hold these three invariants together:

1. **Productive work continues.** Agents with a clear next action must keep working without needing a human to wake them.
2. **Only real blockers stop work.** Stops happen when something genuinely cannot proceed (missing approval, missing dependency, human owner). Pseudo-stops must be detected and routed.
3. **No infinite loops.** Recovery and continuation loops must be bounded and distinguishable from genuinely productive continuation.

If a proposed fix violates any invariant, drop it or rework it. State explicitly how each invariant is held.

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org State

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

stateFile=".monomind/orgs/${org_name}-state.json"
activityFile=".monomind/orgs/${org_name}-activity.jsonl"
issuesFile=".monomind/orgs/${org_name}-issues.json"
routinesFile=".monomind/orgs/${org_name}-routines.json"
```

---

## Step 2 — Execute Action

### scan (default)

Scan for stalled work across the org:

```bash
echo "STALL SCAN — $org_name"
echo "════════════════════════════════════════════════════════"

ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
now=$(date +%s)

echo ""
echo "AGENT HEARTBEATS"
echo "────────────────────────────────────────────────────────"

python3 - "$orgFile" "$stateFile" "$now" <<'PYEOF'
import json, sys, os
from datetime import datetime, timezone

org = json.load(open(sys.argv[1]))
state_path = sys.argv[2]
now = int(sys.argv[3])

hb = {}
if os.path.exists(state_path):
    try:
        state = json.load(open(state_path))
        for r in state.get("roles", []):
            hb[r.get("id","")] = r.get("last_heartbeat")
    except:
        pass

roles = org.get("roles", [])
stalled = []
for r in roles:
    rid   = r.get("id","?")
    title = r.get("title",rid)
    last  = hb.get(rid)
    if not last:
        age = "never"
        stalled.append((rid, title, "no heartbeat"))
    else:
        try:
            dt = datetime.fromisoformat(last.replace("Z","+00:00"))
            age_s = now - int(dt.timestamp())
            age = f"{age_s//60}m ago"
            if age_s > 3600:
                stalled.append((rid, title, f"stale ({age})"))
        except:
            age = "?"
    print(f"  {rid:<28} {title:<24} last: {last or 'never'}")

print()
if stalled:
    print(f"  STALLED AGENTS ({len(stalled)}):")
    for rid, title, reason in stalled:
        print(f"    ⚠  {rid}  {title}  — {reason}")
else:
    print("  All agents have recent heartbeats.")
PYEOF

echo ""
echo "OPEN ISSUES (stall candidates)"
echo "────────────────────────────────────────────────────────"

if [ -f "$issuesFile" ]; then
  python3 - "$issuesFile" "$now" <<'PYEOF'
import json, sys
from datetime import datetime, timezone

data = json.load(open(sys.argv[1]))
now  = int(sys.argv[2])

issues = [i for i in data.get("issues",[])
          if i.get("status") in ("open","in_progress","in_review")]

if not issues:
    print("  (no open/stalled issues)")
else:
    for iss in issues[:20]:
        iid   = iss.get("id","?")[:28]
        title = iss.get("title","-")[:38]
        st    = iss.get("status","?")
        upd   = iss.get("updatedAt","-")[:10]
        asgn  = (iss.get("assigneeId") or "—")[:20]
        print(f"  [{st:<11}] {title:<38} assigned={asgn}  updated={upd}")
PYEOF
else
  echo "  (no issues file)"
fi

echo ""
echo "  For deep diagnosis: /mastermind:diagnose --org $org_name --action diagnose --issue-id <id>"
```

### diagnose

Forensic deep-dive on a specific issue or agent:

```bash
echo "DEEP DIAGNOSIS — $org_name"
echo "════════════════════════════════════════════════════════"
echo ""

if [ -n "$issue_id" ]; then
  echo "ISSUE: $issue_id"
  echo "────────────────────────────────────────────────────────"
  if [ -f "$issuesFile" ]; then
    jq --arg id "$issue_id" '(.issues // [])[] | select(.id == $id)' "$issuesFile" 2>/dev/null \
      || echo "  Issue not found: $issue_id"
  fi
fi

if [ -n "$agent_id" ]; then
  echo ""
  echo "AGENT ACTIVITY: $agent_id"
  echo "────────────────────────────────────────────────────────"
  if [ -f "$activityFile" ]; then
    grep "$agent_id" "$activityFile" | tail -20 | while read -r line; do
      echo "  $line"
    done
  else
    echo "  (no activity log found)"
  fi
fi

echo ""
echo "DIAGNOSIS FRAMEWORK"
echo "────────────────────────────────────────────────────────"
echo "  Walk the issue tree and find the exact stop-point."
echo "  Common stall shapes:"
echo "    1. Issue is 'in_review' with no active run or pending interaction"
echo "    2. Issue is 'in_progress' after a successful run with no next action"
echo "    3. Blocker chain whose leaf is cancelled or inaccessible"
echo "    4. Recovery loop waking the same issue repeatedly after successful runs"
echo "    5. Stranded-work recovery treating its own recovery issues as source work"
echo ""
echo "  Root cause format:"
echo "    - Stop-point: <issue-id> stuck at status=<status> because <reason>"
echo "    - Evidence: <run ids, timestamps, status transitions>"
echo "    - Proposed rule: <rule that prevents recurrence>"
echo "    - Invariant check: [1] productive work continues? [2] real blockers only? [3] bounded?"
```

### report

```bash
echo "DIAGNOSTIC REPORT — $org_name"
echo "════════════════════════════════════════════════════════"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

agentCount=$(jq '.roles | length' "$orgFile")
echo "Org agents:  $agentCount"

if [ -f "$issuesFile" ]; then
  openCount=$(jq '[(.issues // [])[] | select(.status == "open")] | length' "$issuesFile")
  inpCount=$(jq '[(.issues // [])[] | select(.status == "in_progress")] | length' "$issuesFile")
  doneCount=$(jq '[(.issues // [])[] | select(.status == "done")] | length' "$issuesFile")
  echo "Issues:      open=$openCount  in_progress=$inpCount  done=$doneCount"
fi

echo ""
echo "THREE INVARIANT STATUS:"
echo "  1. Productive work continues:  [check heartbeats + open issues]"
echo "  2. Only real blockers stop:    [check stall candidates above]"
echo "  3. No infinite loops:          [check activity log for repeat patterns]"
echo ""
echo "  Run scan first: /mastermind:diagnose --org $org_name --action scan"
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
invariants:
  productive_work_continues: check
  only_real_blockers: check
  no_infinite_loops: check
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
