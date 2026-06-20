# server.mjs Modularization Plan

## Current State
- server.mjs: 5,185 lines (target: <500 per module)
- dashboard.html: 12,558 lines
- No tests; monolithic structure
- Location: `packages/@monomind/cli/dist/src/ui/`

## Why This File (Not `src/browser/dashboard/server.ts`)
`server.mjs` is a hand-written source (not a TypeScript build output).
`src/browser/dashboard/server.ts` (206 lines) is a separate, smaller monobrowse
dashboard — already within size limits. The modularization target is exclusively
`dist/src/ui/server.mjs`.

## Proposed Module Boundaries

### Module 1: `sse-manager.mjs` — SSE client registries + broadcasting  **[EXTRACTED]**
- Owns: `sseClients` Set, `mmSseClients` Set
- Exports: `addSseClient`, `removeSseClient`, `broadcast`, `addMmClient`,
  `removeMmClient`, `broadcastMm`, `closeSseClients`, `getSseClientCount`,
  `getMmClientCount`
- Dependencies: none (pure state + HTTP response objects)
- Estimated size: ~60 lines
- Callers in server.mjs: 15 call-sites across broadcast, add, delete, size

### Module 2: `org-routes.mjs` (org CRUD API handlers)
- Extracts: `GET /api/orgs`, `GET /api/orgs/:name`, `POST /api/orgs`,
  `POST /api/orgs/:name/import`, plus the 30+ `GET /api/org/:name/*` sub-routes
  (activity, projects, members, adapters, skills, agents, health, budgets, etc.)
- Dependencies: fs, path, os, sse-manager (broadcastMm), activeOrgRuns,
  activeSessionsByOrg
- Estimated size: ~900 lines (could be split further into org-crud.mjs +
  org-detail.mjs if needed)

### Module 3: `mastermind-routes.mjs` (mastermind session management)
- Extracts: `POST /api/mastermind/event` handler (`handleMastermindEvent`),
  `GET /api/mastermind-stream` SSE endpoint, `GET /api/mastermind/sessions`,
  `GET /api/mastermind/session/:id`, session JSONL parser
- Dependencies: fs, path, os, sse-manager (addMmClient, removeMmClient,
  broadcastMm), activeOrgRuns, activeSessionsByOrg
- Estimated size: ~350 lines

### Module 4: `data-routes.mjs` (data collection API handlers)
- Extracts: `GET /api/stream` (main SSE), `GET /api/data`, `GET /api/graph`,
  `GET /api/events-stream`, `GET /api/monograph`, file watcher setup
- Dependencies: collector.mjs, sse-manager (addSseClient, removeSseClient,
  broadcast), fs, path
- Estimated size: ~250 lines

### Module 5: `static-handler.mjs` (static file serving + HTML responses)
- Extracts: dashboard HTML serving at `/`, MASTERMIND_DIAGRAM_HTML constant,
  `GET /api/mastermind` static route, favicon
- Dependencies: fs, path
- Estimated size: ~60 lines

## Migration Sequence
1. Extract sse-manager.mjs — no breaking changes, just moves state ownership
2. Update server.mjs to import from sse-manager.mjs (15 call-sites)
3. Extract mastermind-routes.mjs (natural boundary around mastermind feature)
4. Extract org-routes.mjs (largest chunk; may split into org-crud + org-detail)
5. Extract data-routes.mjs (collector.mjs integration)
6. Extract static-handler.mjs (trivial, last)
7. server.mjs becomes: imports, server setup, watcher, shutdown, startServer()
   (~300 lines remaining)

## Safety Rules
- Never change exported function signatures: `startServer()`, `getServerStatus()`
- Never change API route paths or response shapes
- Each extraction: `node --check <file.mjs>` syntax gate before committing
- Keep activeOrgRuns and activeSessionsByOrg in server.mjs until org-routes
  and mastermind-routes are extracted (they are co-dependencies)
- Maintain backward-compat: dashboard.html SSE reconnect uses `/api/stream`

## Progress
- [x] Module 1: sse-manager.mjs extracted (commit: TBD)
- [ ] Module 2: org-routes.mjs
- [ ] Module 3: mastermind-routes.mjs
- [ ] Module 4: data-routes.mjs
- [ ] Module 5: static-handler.mjs
