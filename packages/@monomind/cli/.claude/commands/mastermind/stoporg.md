<!-- Stop a running org. Wraps `monomind org stop`, which writes the stop file the org daemon polls — the daemon exits within about 2s. -->

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: STOP ORG**

Stops a running org cleanly. Runs `monomind org stop <name>`, which writes `.monomind/orgs/<name>/stop`; the org daemon polls for that file and exits within about 2 seconds.

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
stopped  →  (runorg / monomind org run)  →  running
running  →  (stoporg / monomind org stop) →  stopped
running  →  (monomind org pause)         →  paused
paused   →  (monomind org resume)        →  running
```

Your orgs (with live runtime status):

```bash
npx -y monomind@latest org list 2>/dev/null || echo "(none — run /mastermind:createorg to define one)"
```

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>

If `--org` is not provided, list orgs and ask which to stop.

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

Invoke `Skill("mastermind-stoporg")` passing: org_name: `$org_name`, session_id: `$session_id`, caller: "command".

After skill returns: emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    '{type:"session:complete",session:$session,domain:"ops",status:"complete",domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow mastermind-protocol/SKILL.md Brain Write Procedure for domain `ops`.

Invoke `Skill("mastermind-repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
