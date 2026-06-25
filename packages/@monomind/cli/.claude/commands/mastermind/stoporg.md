---
name: mastermind-stoporg
description: Stop a running scheduled org loop. Sets status to "stopped" — the next scheduled wakeup reads the status, skips all work, and does not reschedule. Loop dies within one interval.
---

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: STOP ORG**

Stops a scheduled org loop cleanly. The org's `status` is set to `"stopped"` — the next scheduled wakeup will read the status, skip all work, and not reschedule itself. The loop is guaranteed to die within one interval (no orphaned wakeups).

**Usage:**

```
/mastermind:stoporg --org <name>
```

**Examples:**

```
/mastermind:stoporg --org livarto-issue-resolver
/mastermind:stoporg --org research-pod
```

**Lifecycle:**
```
stopped  →  (runorg)   →  active
active   →  (stoporg)  →  stopped
active   →  (HIL)      →  paused    (set manually in .monomind/orgs/<name>.json)
paused   →  (set active) →  active  (resume by setting status back to "active" in the JSON)
```

Your scheduled orgs:

```bash
ls .monomind/orgs/*.json 2>/dev/null | grep -v -- '-approvals\|-state\|-activity' | \
  xargs -I{} sh -c 'name=$(jq -r ".name" "{}"); status=$(jq -r ".status // \"no-loop\"" "{}"); interval=$(jq -r "if .loop.poll_interval_minutes then \"\(.loop.poll_interval_minutes)m\" else \"—\" end" "{}"); echo "  $name  ($status, $interval)"' 2>/dev/null || echo "(none)"
```

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>

If `--org` is not provided, list orgs with schedules and ask which to stop.

Verify the org file exists:
```bash
[ -f ".monomind/orgs/${org_name}.json" ] || { echo "Org '${org_name}' not found."; exit 1; }
```

Generate a session ID:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Invoke `Skill("mastermind:stoporg")` passing: org_name: `$org_name`, session_id: `$session_id`, caller: "command".

After skill returns: emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    '{type:"session:complete",session:$session,domain:"ops",status:"complete",domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.

Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
