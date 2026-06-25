---
name: mastermind-runorg
description: Start a saved org as a persistent autonomous agent organization. The boss agent coordinates all roles; agents pick up tasks from a shared board and run until stopped.
---

**If $ARGUMENTS is empty:** List saved orgs and display the following.

---

**MASTERMIND: RUN ORG**

Running an org starts an autonomous agent organization. There are two modes:

**Persistent org** (no schedule): a boss agent loads the org definition, assigns work to specialists from a shared board, and loops indefinitely. Stop with `/mastermind:stoporg --org <name>`.

**Scheduled org** (created with `--schedule`): sets the org to `active` and runs the first iteration immediately. Subsequent iterations are self-scheduled via ScheduleWakeup. The loop stops cleanly within one interval after `/mastermind:stoporg --org <name>`.

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

**STEP 0 — Extract loop-control flags (do this FIRST, before any other parsing)**

Scan `$ARGUMENTS` for these flags and store their values. Remove them from the argument string before Step 1:

| Flag | Variable | Default |
|---|---|---|
| `--rep <N>` | `current_rep = N` | absent |
| `--loop <id>` | `LOOP_ID = id` | absent |
| `--tillend` | `tillend_mode = true` | false |
| `--maxruns <N>` | `tillend_maxruns = N` | 50 |
| `--wait <N>` | `wait_seconds = N` | 60 |
| `--repeat <N>` | `repeat_count = N` | 0 |

⚠️ **CRITICAL — CONTINUATION RUNS DO NOT SKIP WORK.** When `--rep N` is present, this is a scheduled continuation triggered by ScheduleWakeup. The org's FULL work cycle MUST still execute every time: session variables → session:start event → Skill("mastermind:runorg") → session:complete event. NEVER short-circuit or skip the org work because `--rep` is present. The `--rep` / `--loop` flags are only consumed by `Skill("mastermind:_repeat")` at the end.

---

**STEP 1 — Parse org-specific flags**

From the remaining `$ARGUMENTS` (after loop flags removed in Step 0):
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

Resolve session ID and project root:
```bash
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
# Reuse the loop's original sessionId for continuation runs (keeps all reps under one session)
if [ -n "${LOOP_ID:-}" ] && [ -f ".monomind/loops/${LOOP_ID}.json" ]; then
  session_id=$(jq -r '.sessionId // empty' ".monomind/loops/${LOOP_ID}.json" 2>/dev/null)
fi
session_id="${session_id:-mm-$(date -u +%Y%m%dT%H%M%S)}"
```

Emit `session:start` to dashboard:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$org_name" \
    --arg proj "$REPO_ROOT" \
    '{type:"session:start",session:$session,domain:"ops",prompt:("Running org: "+$org),mode:"auto",project:$proj,ts:(now*1000|floor)}')" || true
```

Emit `domain:dispatch`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg org "$org_name" \
    --arg proj "$REPO_ROOT" \
    '{type:"domain:dispatch",session:$session,domain:"ops",cmd:("Starting org "+$org+" as persistent daemon"),project:$proj,ts:(now*1000|floor)}')" || true
```

Invoke `Skill("mastermind:runorg")` passing: brain_context, org_name: `$org_name`, session_id: `$session_id`, task: task_override, caller: "command".

After the skill spawns the boss agent and returns: note the status. Emit `session:complete`:
```bash
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg session "$session_id" \
    --arg status "<status>" \
    --arg proj "$REPO_ROOT" \
    '{type:"session:complete",session:$session,domain:"ops",status:$status,domains:["ops"],project:$proj,ts:(now*1000|floor)}')" || true
```

Follow _protocol.md Brain Write Procedure for domain `ops`.


Invoke `Skill("mastermind:_repeat")` now to execute the REPEAT POSTAMBLE. This is a required tool call — do not skip it.

After the REPEAT POSTAMBLE completes, if a loop was started or continued (LOOP_ID is set), write the org name into the loop state file so the dashboard can detect running status:
```bash
if [ -n "${LOOP_ID:-}" ]; then
  LOOP_FILE=".monomind/loops/${LOOP_ID}.json"
  if [ -f "$LOOP_FILE" ]; then
    python3 -c "
import json, sys
f = sys.argv[1]; org = sys.argv[2]
d = json.load(open(f))
if 'orgName' not in d:
    d['orgName'] = org
    open(f, 'w').write(json.dumps(d, indent=2))
" "$LOOP_FILE" "${org_name}" 2>/dev/null || true
  fi
fi
```
