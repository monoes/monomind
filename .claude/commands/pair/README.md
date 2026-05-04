---
name: pair:README
description: Pair programming with Claude Code — driver/navigator modes, TDD sessions, review sessions, Task tool agent spawning, and hooks integration
---

# Pair Programming with Claude Code

Collaborative development using Claude Code as your AI pair partner. No special CLI needed — Claude Code IS the pair partner.

## How It Works

Pair programming with Claude Code means structuring your conversation to get the most out of the collaboration. Depending on your goal, you drive or Claude drives.

## Quick Start

**You drive, Claude reviews (driver mode):**
> "I'm going to implement JWT auth. Review my approach and flag issues as we go."

**Claude drives, you guide (navigator mode):**
> "Implement a JWT auth middleware for Express with refresh token support. I'll review each piece."

**TDD session:**
> "Let's do TDD for this shopping cart feature. Write the failing tests first, then we'll implement."

**Review session:**
> "Review all the changes I've made today to `src/auth/`. Focus on security issues."

## Using the Pair Programming Skill

Invoke the `pair-programming` skill for structured collaboration:

```
/pair-programming
```

This loads the workflow guide and sets up the session context.

## Spawning a Specialized Agent

For long-running or complex sessions, spawn a dedicated coding agent via the Task tool:

```javascript
Task({
  prompt: "Act as a senior developer pair programming partner. The user is implementing JWT auth. Review their code as they write it, suggest improvements, catch issues, and explain patterns. Start by asking what they want to build.",
  subagent_type: "Senior Developer",
  run_in_background: false
})
```

Or use a specific specialist:
- `superpowers:test-driven-development` — TDD-focused pairing
- `superpowers:systematic-debugging` — debugging sessions
- `superpowers:receiving-code-review` — code review sessions

## Hooks Integration

Use hooks to track pair session quality:

```bash
# Register session start
npx monomind hooks pre-task -d "Pair programming: implement JWT auth"

# After session, record outcome
npx monomind hooks post-task --task-id <id> --success true --quality 0.95
```

## Files

- [modes.md](./modes.md) — Driver, navigator, TDD, review, debug modes
- [session.md](./session.md) — Session lifecycle and real monitoring commands
- [examples.md](./examples.md) — Real-world pair programming scenarios

## See Also

- `superpowers:pair-programming` — structured pair programming skill
- `superpowers:test-driven-development` — TDD workflow
- `superpowers:systematic-debugging` — debugging workflow
- `superpowers:requesting-code-review` — code review workflow
- `hooks pre-task` — register task start and get recommendations
