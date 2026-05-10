---
name: mastermind-runorg
description: Start a saved org as a persistent autonomous agent organization. The boss agent coordinates all roles; agents pick up tasks from a shared board and run until stopped.
---

**If $ARGUMENTS is empty:** List saved orgs and display the following.

---

**MASTERMIND: RUN ORG**

Running an org starts a persistent agent organization: a boss agent loads the org definition, assigns work to specialists, monitors progress, and keeps agents on task until you stop them. Agents pick up cards from a shared board — one role per agent, all running in parallel.

This is continuous operation, not a one-shot run. The org loops: plan → execute → review → plan. Stop it explicitly with `/mastermind:ops --stop-org <name>`.

**Your saved orgs:**

```bash
ls .monomind/orgs/*.json 2>/dev/null | xargs -I{} basename {} .json 2>/dev/null || echo "(none — run /mastermind:createorg to define one)"
```

**Usage:**

```
/mastermind:runorg --org <name>

/mastermind:runorg --org content-team --task "Publish the Q2 product roundup post by Friday"

/mastermind:runorg --org research-pod "Focus this week on competitor pricing changes"
```

**Options:**
`--org <name>` — which saved org to start (required; prompted if omitted)
`--task <task>` — override the org's default goal for this run
Any remaining text is passed as additional context to the boss agent.

No orgs yet? Run `/mastermind:createorg` to define one.

---

**If $ARGUMENTS is non-empty:** Execute the flow below.

---

Parse `$ARGUMENTS` for:
- `--org <name>` → org_name = <name>
- `--task <task>` → task_override = <task> (if omitted, task_override = null — the skill uses org's stored goal)
- Remaining text = additional context passed to the boss agent

If `--org` is not provided, list saved orgs and ask which to run:
```bash
orgs=$(ls .monomind/orgs/*.json 2>/dev/null | xargs -I{} basename {} .json 2>/dev/null)
if [ -z "$orgs" ]; then
  echo "No saved orgs found. Run /mastermind:createorg first."
  exit 1
fi
echo "$orgs"
```
Ask: "Which org would you like to start? Available: <list from above>"

Verify the org file exists before proceeding:
```bash
[ -f ".monomind/orgs/${org_name}.json" ] || { echo "Org '${org_name}' not found."; exit 1; }
```
If the file does not exist, stop and suggest running `/mastermind:createorg --name ${org_name}`.

Load brain context for the `ops` domain (follow _protocol.md Brain Load Procedure, namespace: `ops`).

Generate a session ID as a real shell variable:
```bash
session_id="mm-$(date -u +%Y%m%dT%H%M%S)"
```

Emit `session:start` to dashboard:
```bash
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$org_name" \
    '{type:"session:start",session:$session,domain:"ops",prompt:("Running org: "+$org),mode:"auto",ts:(now*1000|floor)}')" || true
```

Emit `domain:dispatch`:
```bash
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$org_name" \
    '{type:"domain:dispatch",session:$session,domain:"ops",cmd:("Starting org "+$org+" as persistent daemon"),ts:(now*1000|floor)}')" || true
```

Invoke `Skill("mastermind:runorg")` passing: brain_context, org_name: `$org_name`, session_id: `$session_id`, task: task_override, caller: "command".

After the skill spawns the boss agent and returns: note the status. Emit `session:complete`:
```bash
curl -s -X POST "http://localhost:4242/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.
