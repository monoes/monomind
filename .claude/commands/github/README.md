---
name: github:README
---

# GitHub Commands

Commands and guidance for GitHub workflow automation in Monomind. All GitHub operations use the `gh` CLI and real monomind MCP tools — there is no `monomind github` CLI command group.

## Commands (invoke as slash commands)

- [github-modes](./github-modes.md) — overview of all GitHub workflow modes and swarm integration patterns
- [issue-tracker](./issue-tracker.md) — issue management and project coordination with swarm agents
- [pr-manager](./pr-manager.md) — pull request lifecycle management with multi-agent review coordination
- [release-manager](./release-manager.md) — release preparation, versioning, and deployment pipeline coordination
- [repo-architect](./repo-architect.md) — repository structure optimization and template management
- [sync-coordinator](./sync-coordinator.md) — multi-package version alignment and cross-repo synchronization

## Real Tools Used

- `gh` CLI — all GitHub operations (issues, PRs, releases, repos, branches)
- `mcp__monomind__swarm_init` / `agent_spawn` — swarm coordination
- `mcp__monomind__coordination_orchestrate` — task coordination across agents (`strategy: parallel|sequential|pipeline|broadcast`)
- `mcp__monomind__memory_store` / `memory_retrieve` — cross-agent state persistence
- `gh` CLI — preferred for all direct GitHub API operations not covered by the above
