---
description: Show the monomind statusline (version, git, swarm, security, hooks, token cost).
type: flow
name: monomind-monomind-monomind-status
---

Run the monomind statusline and report project status. Execute exactly one of these (first that exists):

1. `node .claude/helpers/statusline.cjs --compact`
2. `npx -y monomind@latest hooks statusline --json`  (fallback if the helper is absent)

Parse the JSON and present a concise, readable summary. Include these fields if present:
- monomind version (if discoverable) and git branch
- git: modified / untracked / staged / ahead / behind
- swarm: activeAgents / maxAgents, coordinationActive
- security: status, cvesFixed / totalCves
- hooks: enabled / total
- tokenCost: todayCost, monthCost, todayCalls

Format as a compact table or tight bullet list. Report the numbers only — do not editorialize or add recommendations. If the command errors, say so and show the error.

