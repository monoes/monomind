---
name: monobrowse
description: Launch monomind browse for web UI testing and automation — native TypeScript CDP client, no external binary needed
---

Invoke the agent-browser-testing skill to test or automate a web UI.

`monomind browse` is built-in — no install needed. Invoke the skill:

Skill("agent-browser-testing")

Pass the user's argument (if any) as the URL or task description: $1

Use the full monomind browse workflow:
1. `npx monomind browse open <url>`
2. `npx monomind browse snapshot -i`
3. Act using element refs (@e1, @e2, ...)
4. Re-snapshot to verify
5. Report results (PASS / FAIL / WARN)

Examples: `/monobrowse`, `/monobrowse https://example.com`, `/monobrowse test the login flow`
