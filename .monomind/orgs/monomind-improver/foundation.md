# monomind-improver foundation log

- a380defa — fix(agent-graph): exclude tool-result messages from turn count in /api/graph parser
- 7e1d1987 — fix(agent-graph): count agent spawns in sessions exceeding size cap (lightweight line-filter scan)
- da7b42b8 — fix(update): replace semver import with inline shim in src/checker.ts; add gt() to shim; remove 'semver' from package.json dependencies
- 1a635132 — fix(dashboard): fix v2RenderOrgBudgets to read agent data from budgets endpoint (snake_case keys) and org limits from org_budget.limit_tokens/limit_usd
- 2f507250 — fix(server): add assignee field to /api/org/:name/issues response so dashboard Issues tab shows assignee name
- aecf391d — fix(dashboard): use adapterType/adapterModel in agents-full tab so Type and Adapter columns show real data
- aecf391d — fix(dashboard): read adapterType/adapterModel fields in v2RenderOrgAgentsFull (was reading a.type/a.adapter which don't exist in API response)
- efa06639 — fix(server): normalise authorName/authorId and messageCount in /api/org/:name/threads response so dashboard Threads tab shows author and message count
- 349da223 — fix(server): add updated_at and ts fields to /api/org/:name/my-issues response so dashboard My Issues tab shows timestamps
- 1b6c4020 — fix(dashboard): read data.requests (not data.joinRequests) and r.requesterName in join-requests tab so requests are shown and names display correctly
- 0a91b3d7 — fix(server): include expiresAt in /api/org/:name/invites response so dashboard Invites tab Expires column shows real data
- 0a91b3d7 — fix(server): add expiresAt field to /api/org/:name/invites response so dashboard Invites tab shows expiry column
- 88b84adf — fix(dashboard): use adapterModel field in v2RenderOrgLive so running agent adapter/model name is shown (was reading a.adapter which is always undefined)
- 88b84adf — fix(dashboard): v2RenderOrgLive reads a.adapterModel (not a.adapter) so running agent model name shows in Live tab
- 72e5c9d2 — fix(server): read adapter_config.model in /api/org/:name/agents so adapterModel is populated from actual org config field (was reading r.adapter.model which is always null)
- 72e5c9d2 — fix(server): /api/org/:name/agents reads adapter_config.model for adapterModel (not r.adapter.model which was always undefined)
- 3d530492 — fix(server): add join-requests to _sidecarSuffixRe in /api/orgs so join-requests.json sidecar files are not parsed as org configs
- 45b83170 — fix(dashboard): v2RenderOrgRoutines reads r.last_run (not r.lastRun) and derives status from r.enabled when r.status absent
