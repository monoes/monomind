<!-- Start a saved org via the Org Runtime v2 daemon (monomind org run/serve). Validates the config, auto-migrates v1-shaped configs, starts the daemon, and confirms liveness. The legacy prompt-orchestrated path lives at /mastermind:runorgv1. -->

**If $ARGUMENTS is empty:** Output the following and wait.

---

**MASTERMIND: RUN ORG**

Running an org starts it through the Org Runtime v2 daemon. Every role becomes
a live SDK session; the daemon forwards dashboard events itself — no boss
agent, no monotask board, no manual curl emissions.

**Usage:**

```
/mastermind:runorg --org <name>

/mastermind:runorg --org content-team --task "Publish the Q2 product roundup post by Friday"
```

**Options:**
`--org <name>` — which saved org to start (required; prompted if omitted)
`--task <task>` — override the org's default goal for this run

No orgs yet? Run `/mastermind:createorg` to define one.

Your saved orgs:

```bash
npx -y monomind@latest org list 2>/dev/null || echo "(none — run /mastermind:createorg to define one)"
```

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>
- `--task <task>` → task_override = <task> (if omitted, task_override = null — the skill uses the org's stored goal)

If `--org` is not provided, list saved orgs and ask which to run:
```bash
npx -y monomind@latest org list 2>/dev/null || echo "(none — run /mastermind:createorg to define one)"
```

Load brain context for the `ops` domain (follow _protocol.md Brain Load Procedure, namespace: `ops`).

Generate a session ID:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
```

Invoke `Skill("mastermind-skills:runorg")` passing: org_name: `$org_name`, task: task_override, session_id: `$session_id`, caller: "command".

After skill returns: emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "x-monomind-token: $(cat "${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.monomind/dashboard-token" 2>/dev/null || true)" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.

Invoke `Skill("mastermind-skills:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.
