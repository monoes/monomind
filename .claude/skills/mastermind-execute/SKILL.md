---
name: mastermind-execute
description: Load a written implementation plan, review it critically, execute all tasks step by step, and hand off to mastermind:review when complete.
type: domain-skill
default_mode: confirm
---

# Mastermind Execute

Load plan, review critically, execute all tasks, report when complete.

**Announce at start:** "I'm using the mastermind:execute skill to implement this plan."

**Note:** This skill works best with subagent support (Claude Code). When subagents are available, dispatch one subagent per independent task in a single message.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by master, or loaded standalone via mastermind-protocol/SKILL.md brain load)
- `plan_path`: path to the plan file to execute
- `project_name`: monotask space name
- `board_id`: monotask board ID
- `mode`: auto | confirm

---

## The Process

### Step 1: Load and Review Plan

1. Read the plan file at `plan_path`
2. Review critically — identify any questions or concerns:
   - Missing dependencies or prerequisites
   - Ambiguous instructions
   - Steps that contradict each other
   - Verifications that cannot be run
3. If concerns exist: raise them with the user before starting
4. If no concerns: create a TodoWrite with each task and proceed

### Step 2: Execute Tasks

For each task in the plan:

1. Mark as `in_progress`
2. Follow each step exactly — the plan has bite-sized steps; do not skip or reorder
3. Run verifications as specified in the plan
4. Mark as `completed`

**Dispatching subagents (when available):** when independent tasks can run in parallel, dispatch one subagent per task in a single message via the Task tool. Each subagent starts with no memory of this session — embed the plan step and the `brain_context` received in Inputs directly in its prompt so it has the same grounding this skill was given.

**CRITICAL — variable substitution required:** before constructing the Task prompt, replace `${brain_context}` and `${project_name}` below with their actual literal values (the BRAIN CONTEXT block from Inputs, and the project name) — an unsubstituted `${brain_context}` placeholder means the subagent executes blind to prior decisions and constraints. This is the same substitution discipline `mastermind-idea/SKILL.md` uses for its Task prompts.

```javascript
Task({
  subagent_type: "coder", // pick per task, per the plan's agent recommendation
  description: "<task title from plan>",
  run_in_background: false, // true only when running independently alongside other parallel tasks
  prompt: `You are executing one task from an implementation plan for project "${project_name}".

BRAIN CONTEXT:
${brain_context}

TASK: <task title>
STEPS:
<verbatim bite-sized steps for this task from the plan>

VERIFICATION:
<verification command(s) from the plan>

Follow the steps exactly — do not skip, reorder, or invent steps not listed. Run the verification before reporting done.`
})
```

When the plan references skills:
- `mastermind:taskdev` → this skill; continue inline (no separate taskdev skill exists)
- `mastermind:verify` → invoke `Skill("mastermind-review")`
- Any other `mastermind:*` skill → invoke `Skill("mastermind-<name>")`

### Step 3: Complete Development

After all tasks complete and are verified:

- Announce: "All tasks complete. Handing off to mastermind:review."
- **REQUIRED SUB-SKILL:** invoke `Skill("mastermind-review")`
- Follow that skill to verify the work before any merge, PR, or release step

---

## When to Stop and Ask for Help

**STOP executing immediately when:**
- A blocker is encountered (missing dependency, failing test, unclear instruction)
- The plan has critical gaps preventing a task from starting
- An instruction cannot be understood without guessing
- A verification fails repeatedly (more than twice)

**Ask for clarification rather than guessing.** Never invent steps not in the plan.

**Required stop-report format.** When any condition above fires, report using this exact structure — never just "I'm stuck" or a bare "please advise":

```
STOP — <one-line description of what blocked>

Task:      <the specific plan task/step that stopped, e.g. "Task 3: Add rate limiter">
Tried:     <what was actually attempted — commands run, files checked, approaches tried — not just "it failed">
Result:    <the actual error, output, or contradiction observed>
Need:      <the exact decision or input required to unblock — a choice between named options,
           a missing value, or explicit permission for a specific next step>
```

Example:

```
STOP — verification fails repeatedly on Task 3

Task:      Task 3: Add rate limiter to /api/upload
Tried:     Ran `npm test -- rate-limiter.test.ts` 3x after adding express-rate-limit
           middleware per plan step 3.2. Confirmed middleware order matches the plan.
           Checked for port conflicts (none). Re-read plan steps 3.1-3.4 — no gap found.
Result:    Test "blocks after 100 requests/min" fails every run: expected 429, got 200.
           express-rate-limit v7's `max` option appears to be silently ignored — same
           failure with max:1.
Need:      Decide between (a) pin express-rate-limit to v6 (last version where `max`
           worked as documented) or (b) switch to a different limiter library — the plan
           doesn't specify a version. Confirm which, or provide the correct v7 config.
```

The report must let the user act without re-deriving the investigation themselves — never a vague "please advise" with no Task/Tried/Result/Need detail.

---

## When to Revisit Earlier Steps

**Return to Step 1 (Review) when:**
- The user updates the plan based on feedback
- A fundamental approach needs rethinking due to new information

**Do not force through blockers.** Stop and ask.

---

## Rules

- Review the plan critically before touching any code
- Follow plan steps exactly — do not improvise
- Do not skip verifications
- Reference skills when the plan says to invoke them
- Stop when blocked; never guess — use the required stop-report format above
- Never start implementation on `main` or `master` without explicit user consent

---

## Integration

**Skills used by this skill:**
- `Skill("mastermind-plan")` — creates the plan this skill executes
- `Skill("mastermind-review")` — verification gate after all tasks complete
- `Skill("mastermind-debug")` — when a task fails for a reason the plan did not anticipate
