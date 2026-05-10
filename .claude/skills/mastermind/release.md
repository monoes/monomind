---
name: mastermind-release
description: Mastermind release domain — versioning, changelog, deployment coordination. Spawns a Release Manager who coordinates testing and devops agents for a safe, traceable release pipeline.
type: domain-skill
default_mode: auto
---

# Mastermind Release Domain

This skill is invoked by `mastermind:master` or directly via `/mastermind:release`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via _protocol.md brain load)
- `prompt`: the release goal (version target, scope, environment)
- `project_name`: monotask space name
- `board_id`: monotask board ID (set by master, or created standalone)
- `mode`: auto | confirm

---

## Complexity Assessment

Assess the prompt to determine execution mode:

**Simple (direct execution):** Single-step release action:
- "Bump the version to 1.2.3 in package.json"
- "Generate a changelog for this git range"
→ Use a single release-manager or coder agent. Skip manager delegation.

**Complex (spawn Release Manager agent):** Any of these:
- Full end-to-end release (version + changelog + tests + deploy)
- Multi-environment deployment (staging → production)
- Release requiring review gates or rollback plan
- Coordinated release across multiple packages
→ Spawn Release Manager agent with full briefing.

---

## Standalone Execution (when called without master)

If this skill is invoked directly (not by master):

1. Load brain context following _protocol.md Brain Load Procedure (namespace: `release`)
2. Run intake from _intake.md if prompt is vague
3. Follow _protocol.md Monotask Space+Board Setup Procedure:
   ```bash
   project_name="${project_name:-$(basename "$PWD")}"
   space_id=$(monotask space list 2>/dev/null | awk -F' \| ' -v n="$project_name" '$2==n{print $1}' | head -1)
   [ -z "$space_id" ] && space_id=$(monotask space create "$project_name" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
   [ -z "$space_id" ] && { echo "ERROR: Could not find or create space '$project_name'"; exit 1; }
   board_id=$(monotask board create "release" --json | jq -r '.id // empty')
   [ -z "$board_id" ] && { echo "ERROR: Failed to create release board"; exit 1; }
   monotask space boards add "$space_id" "$board_id" >/dev/null 2>&1 || true
   todo_col=$(monotask column create "$board_id" "Todo"  --json | jq -r '.id')
   doing_col=$(monotask column create "$board_id" "Doing" --json | jq -r '.id')
   done_col=$(monotask column create "$board_id" "Done"  --json | jq -r '.id')
   ```
4. Proceed with complexity assessment below
5. At end: follow _protocol.md Brain Write Procedure (namespace: `release`)

---

## Complex Execution — Release Manager Agent

Spawn a Release Manager agent via Task tool:

```javascript
Task({
  subagent_type: "coordinator",
  description: `You are the Release Manager for project <project_name>.

CONTEXT: <date> | Project: <project_name> | Spawned by: mastermind:release

BRAIN CONTEXT:
<brain_context>

YOUR BOARD: <board_id>
YOUR GOAL: <prompt>

STEP 1 — PLAN
Decompose the release into ordered stages. Identify for each stage:
- Pre-release: version bump, changelog, final tests
- Release: build, package, deploy to target environment
- Post-release: smoke tests, monitoring check, announcement prep
- Rollback plan: what triggers a rollback and how to execute it

STEP 2 — CREATE TASKS
For each release stage, create a monotask card on the project board. First look up column IDs and assign shell variables:
```bash
columns=$(monotask column list "$BOARD_ID" --json)
COL_TODO_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Todo" or .title == "Backlog") | .id' | head -1)
COL_DONE_ID=$(echo "$columns" | jq -r '.[] | select(.title == "Done") | .id' | head -1)
```
Then create the card:
```bash
result=$(monotask card create "$BOARD_ID" "$COL_TODO_ID" "<short summary of release stage goal, ≤80 chars>" --json)
CARD_ID=$(echo "$result" | jq -r '.id // empty')
monotask card set-description "$BOARD_ID" "$CARD_ID" "[specific release stage goal]"
monotask card comment add "$BOARD_ID" "$CARD_ID" "CONTEXT: <date> | Project: <project_name> | Created by: Release Manager
BRAIN MEMORY: [paste most relevant 3-5 brain context excerpts]
SCOPE: [packages, environments, services in scope]
CONSTRAINTS: [breaking change rules, downtime windows, rollback triggers, compliance gates]
SUCCESS CRITERIA:
- [ ] [checkable item — e.g. \"all tests green before deploy\"]
AGENT: [release-manager | tester | DevOps Automator | cicd-engineer]
SWARM: hierarchical 5 raft
DEPENDENCIES: [prior stage task ID — release pipeline is sequential]
OUTPUT FORMAT: unified output schema"
```

STEP 3 — EXECUTE
Spawn Task agents in release order (hierarchical raft — coordinator maintains authoritative release state):
- Pre-release prep: subagent_type "release-manager"
- Testing gate: subagent_type "tester"
- Infrastructure and deploy: subagent_type "DevOps Automator"
- CI/CD pipeline: subagent_type "cicd-engineer"

Also run /monomind:do --board <board_id> to track execution.

STEP 4 — COLLECT AND RETURN
Collect all stage outcomes. Return to caller:

domain: release
status: complete | partial | blocked
artifacts:
  - path: [changelog file, release notes, deployment manifest]
    type: config
decisions:
  - what: [version strategy, deploy window, rollback threshold]
    why: [reasoning]
    confidence: [0.0-1.0]
    outcome: shipped | pending | reverted
lessons:
  - what_worked: [what made the release smooth]
  - what_didnt: [what caused delays or required rollback]
next_actions:
  - [e.g. "run mastermind:ops to monitor post-release metrics"]
  - [e.g. "run mastermind:review on the next release candidate"]
board_url: monotask://<project_name>/release
run_id: <ISO8601-timestamp>`,
  run_in_background: true
})
```

---

## Simple Execution

For simple tasks (single agent, single step):

1. Spawn one Task agent with the release action as a self-contained briefing
2. Collect output
3. Return unified output schema with `status: complete`

---

## Domain Swarm Defaults

| Task Type | Agent | Swarm |
|---|---|---|
| Full end-to-end release | coordinator + tester + devops | hierarchical 5 raft specialized |
| Multi-package release | coordinator + release-manager | hierarchical 5 raft specialized |
| Deploy only | DevOps Automator | hierarchical 3 raft specialized |
| Test gate | tester | star 4 raft parallel |
| Changelog / version bump | release-manager | single agent |
