---
description: List all available extras specialist agents, optionally filtered by category.
---

List all extras specialist agents from the non-dev agent registry.

**Usage:** `/list-agents` or `/list-agents <category>`

**Categories:** academic, design, marketing, paid-media, product, project-management, sales, specialized, support

Run this immediately:

```bash
node "${CLAUDE_PROJECT_DIR:-/Users/morteza/Desktop/tools/monobrain}/.claude/helpers/hook-handler.cjs" list-extras $ARGUMENTS
```

After running, show the output to the user as a formatted list grouped by category. Mention they can activate any agent with `/use-agent <slug>`.
