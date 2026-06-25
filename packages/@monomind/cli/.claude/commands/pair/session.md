---
name: pair:session
description: Pair programming session lifecycle — pre-session setup, context setting, mid-session quality checks, breakpoints, end-of-session recording, and multi-session continuity
---

# Pair Programming Session Lifecycle

How to structure a productive pair programming session from start to finish.

## 1. Before You Start

Get routing and context from the hooks system:

```bash
# Register the task and get agent/model recommendations
npx monomind hooks pre-task -d "Pair programming: implement [feature]"
```

Load relevant context from memory:

```bash
npx monomind memory search --query "[feature domain]" --type hybrid
```

## 2. Set Session Context

Tell Claude everything it needs to know upfront:

```
Context for this session:
- Goal: [what we're building]
- Mode: [driver/navigator/TDD/review]
- Stack: [language, framework, key libraries]
- Constraints: [any architectural decisions already made]
- Focus: [what matters most — correctness / speed / learning]
```

The more context upfront, the less correction mid-session.

## 3. During the Session

**Keeping the session focused:**
- One concern at a time — don't mix "implement auth" with "also fix the bug in payments"
- Check in at logical breakpoints: "Before we continue, does this approach make sense?"
- If you get stuck: "I'm not sure how to handle [edge case]. What are our options?"

**Real-time quality checks:**
```bash
# Watch system status during long sessions
npx monomind status --watch

# Check test state
# (run your test suite normally)
```

**Capture decisions as you go:**
```bash
# Store important patterns discovered during session
npx monomind memory store --key "session-[date]-[feature]" \
  --value "[what we decided and why]" \
  --namespace "decisions"
```

## 4. Breakpoints and Handoffs

Use natural stopping points:
- After implementing a complete unit (function, class, endpoint)
- Before switching between subsystems
- When you need to run tests and wait

At each breakpoint:
> "Summarize what we've done so far and what comes next."

This keeps both you and Claude aligned on state.

## 5. End of Session

Record outcomes for future sessions:

```bash
# Record task completion
npx monomind hooks post-task --task-id <id> --success true --quality 0.9

# Store any patterns worth remembering
npx monomind memory store \
  --key "pattern-[name]" \
  --value "[the pattern we found/confirmed]" \
  --namespace "patterns"
```

Get a session summary:
> "Summarize: what did we build, what decisions did we make, and what's left to do?"

## Session Anti-Patterns

| Anti-pattern | Instead |
|---|---|
| Asking 5 things at once | One question at a time |
| No upfront context | Always set context first |
| Never verifying Claude's code | Test frequently, review before committing |
| Letting the session drift | Define the goal, return to it |
| Skipping the summary | Always end with a recap |

## Multi-Session Continuity

Use the hooks session system to restore context across conversations:

```bash
# At session end — persist state
npx monomind hooks session-end

# Next session — restore
npx monomind hooks session-restore
```

Or just tell Claude at the start of the next session:
> "We were implementing JWT auth. We finished the token generation but still need the refresh token endpoint. Continue from there."

## See Also

- [modes.md](./modes.md) — pick the right collaboration mode
- [examples.md](./examples.md) — real workflow examples
- `hooks pre-task` / `hooks post-task` — task tracking
- `memory store` / `memory search` — persist session knowledge
