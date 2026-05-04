---
name: pair:examples
description: Real-world pair programming scenarios — JWT auth, memory leak debugging, TDD, code review, and refactoring with effective prompt patterns
---

# Pair Programming Examples

Real-world scenarios with actual Claude Code patterns — no fictional CLI.

---

## Example 1: Feature Implementation (Navigator Mode)

**Goal:** Implement JWT authentication with refresh tokens.

**Setup:**
```bash
npx monomind hooks pre-task -d "Implement JWT auth with refresh tokens"
```

**Session:**

> "Implement JWT auth middleware for Express. Include: access token (15min expiry), refresh token (7 days), token rotation on refresh, and blacklisting revoked tokens. Start with the token generation utilities, then we'll do the middleware."

Claude implements. Review each piece:

> "Good. One issue: store refresh tokens in Redis, not in-memory. Update that before continuing."

After middleware is done:

> "Now write unit tests for the token generation utilities. Use Jest. Cover: valid tokens, expired tokens, tampered tokens, and token rotation."

End:
> "Summarize what we built and what's still needed before this is production-ready."

```bash
npx monomind hooks post-task --task-id <id> --success true --quality 0.9
```

---

## Example 2: Debugging (Debug Mode)

**Goal:** Memory leak in a Node.js service.

**Setup:**
```
Skill("superpowers:systematic-debugging")
```

Or directly:

> "Debug session: our Node.js service leaks memory — grows from 150MB to 450MB over 10 minutes, then crashes. I'll share code as needed. Start by asking me questions to narrow down the cause."

Claude asks targeted questions. You share relevant code sections.

> "Here's the event emitter setup: [paste code]"

> "Found it: EventEmitter listeners aren't removed on cleanup. Show me the fix and explain why this pattern causes the leak."

Apply the fix, verify:

> "Fixed. Write a test that would have caught this — one that monitors memory over time or checks listener counts."

---

## Example 3: TDD (TDD Mode)

**Goal:** Shopping cart feature, test-first.

**Setup:**
```
Skill("superpowers:test-driven-development")
```

Or:

> "TDD session: shopping cart. Write failing tests first for: add item, remove item, update quantity, calculate total, apply discount. Then I'll implement each. Don't write implementation code — just tests."

**Red phase:** Claude writes failing tests. You read and understand each.

**Green phase:** You implement just enough to pass.

> "Tests passing. Now refactor the total calculation — it's too long."

Claude refactors. You verify tests still pass.

> "Next cycle: write failing tests for the discount system."

---

## Example 4: Code Review (Review Mode)

**Goal:** Review a PR diff before merging.

**Setup:**
```bash
git diff main...feat/auth > /tmp/auth-diff.txt
```

> "Review this PR. File: `src/auth/middleware.ts`. Rate: (1) correctness, (2) security vulnerabilities, (3) error handling, (4) test coverage. List issues as: [CRITICAL] / [MAJOR] / [MINOR] with file+line."

Review output guides your fixes. For each CRITICAL issue:

> "Fix #2 (JWT secret in code). Show me the corrected version."

After applying fixes:

> "Any remaining issues worth fixing before merge?"

---

## Example 5: Refactoring (Driver Mode)

**Goal:** Modernize callback-heavy code to async/await.

> "Driver mode: I'm refactoring `UserService.js` from callbacks to async/await. Watch what I change and flag if I miss anything or introduce bugs. I'll share the original first."

Paste the original code.

> "Here's the original getUserById. I'm changing it to async/await now."

Paste your refactored version.

Claude reviews: "Looks good, but you're missing error handling on the database call. Add a try/catch."

Continue through each function.

At end:

> "Final check: any patterns in the refactored code that should be extracted into utilities?"

---

## Effective Prompts Reference

| Situation | Prompt |
|---|---|
| Start navigator mode | "Implement [X]. I'll review each section before you continue." |
| Start driver mode | "I'm implementing [X]. Review as I share code and flag issues." |
| Start TDD | "Write failing tests for [X] first. I'll implement after." |
| Start review | "Review [file/diff]. Focus on [concern]. Rate and list issues." |
| Start debug | "Debug [symptom]. Ask me questions to narrow down the cause." |
| Switch mode | "Now you drive — implement [next piece] based on what we've discussed." |
| Mid-session check | "Before we continue: summarize state and confirm the next step." |
| End session | "Summarize: what we built, decisions made, what's left." |
| Get unstuck | "I'm not sure how to handle [edge case]. What are the options?" |
| Pattern question | "Is this the right pattern here, or is there a better approach?" |

## See Also

- [modes.md](./modes.md) — choosing the right mode
- [session.md](./session.md) — session lifecycle and tracking
- `superpowers:pair-programming` — structured pair programming skill
- `superpowers:test-driven-development` — full TDD workflow
- `superpowers:systematic-debugging` — debugging methodology
