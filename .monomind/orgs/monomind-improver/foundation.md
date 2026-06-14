# monomind-improver foundation log

- a380defa — fix(agent-graph): exclude tool-result messages from turn count in /api/graph parser
- 7e1d1987 — fix(agent-graph): count agent spawns in sessions exceeding size cap (lightweight line-filter scan)
- da7b42b8 — fix(update): replace semver import with inline shim in src/checker.ts; add gt() to shim; remove 'semver' from package.json dependencies
- 1a635132 — fix(dashboard): fix v2RenderOrgBudgets to read agent data from budgets endpoint (snake_case keys) and org limits from org_budget.limit_tokens/limit_usd
- 2f507250 — fix(server): add assignee field to /api/org/:name/issues response so dashboard Issues tab shows assignee name
- aecf391d — fix(dashboard): use adapterType/adapterModel in agents-full tab so Type and Adapter columns show real data
- aecf391d — fix(dashboard): read adapterType/adapterModel fields in v2RenderOrgAgentsFull (was reading a.type/a.adapter which don't exist in API response)
