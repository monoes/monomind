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
- Stop when blocked; never guess
- Never start implementation on `main` or `master` without explicit user consent

---

## Integration

**Skills used by this skill:**
- `Skill("mastermind-plan")` — creates the plan this skill executes
- `Skill("mastermind-review")` — verification gate after all tasks complete
- `Skill("mastermind-debug")` — when a task fails for a reason the plan did not anticipate
