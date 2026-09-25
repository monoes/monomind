---
name: pair-programming
description: AI pair programming workflow with Claude as driver, navigator, reviewer, or mentor. Supports TDD, debugging, refactoring, review, and learning sessions using Claude Code tools, Task-tool agents, and real monomind commands (hooks, memory, session) for tracking and continuity. There is no pair CLI; the session is run in the conversation.
---

# Pair Programming

Collaborative pair programming where Claude acts as your partner in a defined role. The CLI has no `pair` command: the session lives in the conversation. Claude uses its normal tools (Read, Edit, Bash, the Task tool) plus real `monomind` commands for task tracking, shared memory, and continuity across sessions.

## What This Skill Does

- **Role management**: Claude takes a clear role (driver, navigator, reviewer, mentor) and switches when asked
- **Continuous review**: every change is reviewed for correctness, security, and readability before moving on
- **Test discipline**: tests run after each meaningful change; TDD sessions write failing tests first
- **Specialist help**: Claude can spawn Task-tool agents (tester, reviewer, Security Engineer) for focused checks
- **Continuity**: decisions go into `monomind memory`; outcomes go into `monomind hooks` so routing learns

## Prerequisites

**Required:**
- Claude Code
- Git repository (recommended, so every step can be diffed and reverted)

**Optional:**
- Monomind CLI (`npm install -g monomind@latest`, or `npx monomind`) for tracking and memory
- Test framework, linter, and formatter configured in the project

## Quick Start

Tell Claude the goal and the role:

> "Pair with me on JWT auth. You navigate: I write the code, you review each piece and flag issues."

> "Pair with me on the shopping cart, TDD. You write the failing tests first, I implement."

Optionally register the task so the hooks system can suggest agents and record the outcome:

```bash
npx monomind hooks pre-task --description "Pair: implement JWT auth" --task-id pair-jwt
```

## Roles and Modes

### Driver (Claude writes, you guide)

Claude writes the code with Edit/Write; you set direction and approve each step.

**Claude's protocol:**
1. State the plan for the next small step (one function, one endpoint)
2. Implement it
3. Run the relevant tests or build
4. Show the diff and wait for your review before the next step

**Best for:** scaffolding, boilerplate, rapid prototyping, exploring an unfamiliar library.

### Navigator (you write, Claude reviews)

You write the code; Claude reads each change (Read, `git diff`) and reviews it.

**Claude's protocol:**
1. Keep the overall direction and the list of open concerns
2. Review each change for bugs, edge cases, security, and naming
3. Suggest the next step, but do not edit files unless asked

**Best for:** learning, work you want to own, debugging with a hypothesis.

### Switch

Alternate roles at natural breakpoints (after a complete unit, before changing subsystems), or on request:

> "Switch - you drive the refresh-token endpoint."

### TDD

Red, green, refactor:
1. Claude writes one failing test and runs it to confirm it fails for the right reason
2. The driver writes the minimal code to pass
3. Run the tests; refactor together with the tests green
4. Repeat for the next behavior

For bug-driven TDD, load the `mastermind-debug` skill (failing test first, then fix).

### Review

Claude reviews existing code or a diff and reports issues by severity (critical, major, minor) with file and line. For a thorough multi-angle review, load `mastermind-review`; for working through review feedback you received, load `mastermind-receive-review`.

### Debug

Claude asks targeted questions, forms hypotheses, and verifies each with a test, log, or reproduction before proposing a fix. Load `mastermind-debug` for the full root-cause protocol.

### Mentor

Claude explains the reasoning behind each suggestion, offers alternatives with trade-offs, and lets you do the implementation.

## Using Specialist Agents

For focused checks during a session, Claude spawns Task-tool agents and reports back:

```javascript
Task({
  subagent_type: "tester",
  prompt: "Write unit tests for src/auth/token.ts: valid, expired, tampered, and rotated tokens. Run them and report failures.",
})

Task({
  subagent_type: "Security Engineer",
  prompt: "Review the diff in src/auth/ for auth and token-handling vulnerabilities. Report findings with file and line.",
})
```

To get agent suggestions for a task:

```bash
npx monomind hooks route --task "Review JWT refresh token rotation"
npx monomind pick --task "Review JWT refresh token rotation" --agents
```

## Session Workflow

### 1. Set Context

```
Goal: [what we're building]
Mode: [driver / navigator / switch / TDD / review / debug / mentor]
Stack: [language, framework, key libraries]
Constraints: [decisions already made]
Focus: [correctness / speed / learning]
```

Load relevant prior decisions:

```bash
npx monomind memory search --query "auth token decisions" --namespace decisions
```

### 2. Work in Small Steps

- One concern at a time
- Run tests after every meaningful change (`npm test`, `pytest`, ...)
- Show diffs (`git diff`) at each breakpoint
- Summarize state before switching roles or subsystems

### 3. Capture Decisions

```bash
npx monomind memory store --key "pair-jwt-refresh-storage" \
  --value "Refresh tokens stored in Redis, rotated on every refresh" \
  --namespace decisions
```

### 4. Record Edits and Outcomes (optional)

```bash
npx monomind hooks post-edit --file "src/auth/token.ts" --success true
npx monomind hooks post-task --task-id pair-jwt --success true --outcome "JWT auth with refresh rotation"
```

### 5. Close the Session

> "Summarize: what we built, the decisions we made, and what's left."

```bash
# Persist session state for the next conversation
npx monomind hooks session-end

# Or save a named checkpoint
npx monomind session save --name "pair-jwt" --description "token utils done, refresh endpoint next"
```

Next time:

```bash
npx monomind hooks session-restore
npx monomind session list
```

## Real-World Examples

### Feature Implementation (Claude drives)

> "Pair on JWT auth for Express, you drive. Access token 15 min, refresh token 7 days, rotation on refresh, revocation list. Start with token utilities; stop after each piece for my review."

Claude implements the utilities, runs tests, shows the diff. You review:

> "Store refresh tokens in Redis, not in memory. Fix that, then do the middleware."

### Bug Fixing (debug)

> "Debug with me: the service grows from 150MB to 450MB in 10 minutes and crashes. Ask me questions to narrow it down."

Claude narrows it to event listeners that are never removed, writes a test that checks listener counts, confirms it fails, then fixes it.

### TDD

> "TDD the shopping cart: add, remove, update quantity, total, discount. Write one failing test at a time; I implement."

### Refactoring (you drive)

> "I'm converting UserService.js from callbacks to async/await. Navigate: review each function as I change it and run the tests after each."

### Performance

> "Pair on the slow /search endpoint. Profile first, then propose one change at a time with a before/after measurement."

## Best Practices

1. **Clear goal and role** - state both at the start
2. **Small steps** - one reviewable change at a time
3. **Test continuously** - never stack untested changes
4. **Review before commit** - read the full diff together
5. **Record decisions** - `memory store` for anything the next session needs
6. **End with a recap** - what's done, what's decided, what's next

## Anti-Patterns

| Anti-pattern | Instead |
|---|---|
| Asking for five things at once | One step at a time |
| No upfront context | Set goal, mode, stack, constraints first |
| Accepting code without running it | Run tests after each change |
| Letting the session drift | Return to the stated goal |
| Skipping the recap | Always summarize before ending |

## Related

- `.claude/commands/pair/` - modes, session lifecycle, and examples
- `mastermind-debug`, `mastermind-review`, `mastermind-receive-review` skills
- `hooks-automation` skill - hook wiring and outcome recording
- `npx monomind memory --help`, `npx monomind session --help`, `npx monomind hooks --help`
