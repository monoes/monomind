---
name: mastermind-heartbeat
description: Mastermind heartbeat — trigger a manual heartbeat for a specific agent in a running org. The agent wakes, checks its task queue, executes pending work, and reports back.
type: domain-skill
default_mode: auto
---

# Mastermind Heartbeat

This skill is invoked by `mastermind:heartbeat` or directly via `/mastermind:heartbeat`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block
- `org_name`: org the agent belongs to
- `agent_id`: role id of the agent to wake (e.g. `content-writer`)
- `context`: optional additional context/instructions to pass to the agent during this heartbeat
- `source`: timer | on_demand | assignment | automation (default: on_demand)
- `timeout_min`: minutes to wait for completion (default: 10)
- `caller`: command | master

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Load Org Config

```bash
orgFile=".monomind/orgs/${org_name}.json"
stateFile=".monomind/orgs/${org_name}-state.json"

[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found. Run /mastermind:createorg first."; exit 1; }

board_id=$(jq -r '.board_id // empty' "$orgFile")
todo_col=$(jq -r '.todo_col_id // empty' "$orgFile")
doing_col=$(jq -r '.doing_col_id // empty' "$orgFile")
done_col=$(jq -r '.done_col_id // empty' "$orgFile")
memNs="org:${org_name}"
```

---

## Step 2 — Validate Agent

```bash
agentConfig=$(jq --arg id "$agent_id" '.roles[] | select(.id == $id)' "$orgFile")
[ -z "$agentConfig" ] && { echo "ERROR: Agent '$agent_id' not found in org '$org_name'."; exit 1; }

agentTitle=$(echo "$agentConfig" | jq -r '.title')
agentType=$(echo "$agentConfig" | jq -r '.agent_type')
agentResp=$(echo "$agentConfig" | jq -r '.responsibilities | join("; ")')
reportsTo=$(echo "$agentConfig" | jq -r '.reports_to // "none"')
```

---

## Step 3 — Update State and Emit heartbeat:start

```bash
[ ! -f "$stateFile" ] && echo '{"agents":{}}' > "$stateFile"
tmp="${stateFile}.tmp"
jq --arg id "$agent_id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg source "${source:-on_demand}" \
   '.agents[$id].last_heartbeat = $ts | .agents[$id].status = "running" | .agents[$id].heartbeat_source = $source' \
   "$stateFile" > "$tmp" && mv "$tmp" "$stateFile"

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$REPO_ROOT/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
curl -s -X POST "${CTRL_URL}/api/mastermind/event" \
  -H "Content-Type: application/json" \
  -d "$(jq -cn \
    --arg org "$org_name" \
    --arg role "$agent_id" \
    --arg title "$agentTitle" \
    --arg source "${source:-on_demand}" \
    '{type:"org:heartbeat:start",org:$org,role:$role,title:$title,source:$source,ts:(now*1000|floor)}')" || true
```

---

## Step 4 — Spawn Agent for One Heartbeat Cycle

```javascript
Task({
  subagent_type: agentType,
  description: `Heartbeat for ${agentTitle} in org "${org_name}"`,
  run_in_background: false,
  prompt: `You are ${agentTitle} in the autonomous organization "${org_name}".

This is a HEARTBEAT CYCLE — a single work session triggered ${source || "on_demand"}.

YOUR ROLE: ${agentTitle}
YOUR RESPONSIBILITIES: ${agentResp}
REPORTS TO: ${reportsTo}
MEMORY NAMESPACE: ${memNs}

${context ? `CONTEXT / INSTRUCTIONS FOR THIS HEARTBEAT:\n${context}\n\n` : ""}

TASK BOARD:
- board_id: ${board_id}
- Todo column: ${todo_col}
- Doing column: ${doing_col}
- Done column: ${done_col}

HEARTBEAT PROCEDURE:
1. Check your task queue — unclaimed cards with "role:${agent_id}" label in Todo:
   monotask card list ${board_id} --col ${todo_col} --json | jq '[.[] | select((.labels // []) | index("role:${agent_id}")) | select((.labels // []) | index("claimed") | not)]'

2. For each unclaimed task:
   a. Move to Doing: monotask card move ${board_id} $CARD_ID ${doing_col}
   b. Add "claimed" label: monotask card label add ${board_id} $CARD_ID "claimed"
   c. Execute the work described in the task title
   d. Store output: npx monomind@latest memory store --key "${memNs}:output:${agent_id}:$CARD_ID" --namespace "${memNs}" --value "<your output>"
   e. Move to Done: monotask card move ${board_id} $CARD_ID ${done_col}

3. If no tasks, check memory for any pending instructions:
   npx monomind@latest memory search --query "instruction ${agent_id}" --namespace "${memNs}"

4. Report completion — emit heartbeat:complete event:
   CTRL_URL=$(jq -r '.url // "http://localhost:4242"' "$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.monomind/control.json" 2>/dev/null || echo "http://localhost:4242")
   curl -s -X POST "${CTRL_URL}/api/mastermind/event" -H "Content-Type: application/json" \
     -d "$(jq -cn --arg org "${org_name}" --arg role "${agent_id}" --arg title "${agentTitle}" \
       '{type:"org:heartbeat:complete",org:$org,role:$role,title:$title,ts:(now*1000|floor)}')" || true

Complete your tasks then exit. This is a single heartbeat cycle, not a persistent loop.`
})
```

---

## Step 5 — Update State After Completion

```bash
tmp="${stateFile}.tmp"
jq --arg id "$agent_id" --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
   '.agents[$id].status = "idle" | .agents[$id].last_heartbeat_complete = $ts' \
   "$stateFile" > "$tmp" && mv "$tmp" "$stateFile"
```

---

## Step 6 — Return Output

```yaml
domain: ops
status: complete
org: <org_name>
agent_id: <agent_id>
agent_title: <agentTitle>
heartbeat_source: <source>
```

Print: "Heartbeat complete for <agentTitle>. Check outputs with: npx monomind@latest memory search --namespace org:<org_name>"

---

## Step 7 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
