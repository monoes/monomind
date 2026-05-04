---
name: hooks:README
---

# Hooks Commands

Self-learning hooks system for intelligent workflow automation. Invoked as `npx monomind hooks <subcommand>`.

## Commands (invoke as slash commands)

- [overview](./overview.md) — hooks system overview, Claude Code integration, settings.json config
- [setup](./setup.md) — how to configure hooks in settings.json
- [pre-edit](./pre-edit.md) — get context and agent suggestions before editing a file
- [post-edit](./post-edit.md) — record edit outcome for learning
- [pre-task](./pre-task.md) — register task start, get agent suggestions and model routing
- [post-task](./post-task.md) — record task completion for pattern learning
- [session-end](./session-end.md) — end session and persist state

## All Real Subcommands (25+)

```
pre-edit          Get context and agent suggestions before editing a file
post-edit         Record editing outcome for neural pattern learning
pre-command       Assess risk before executing a command
post-command      Record command execution outcome
pre-task          Register task start and get agent suggestions + model routing
post-task         Record task completion for learning
session-end       End current session and persist state
session-restore   Restore a previous session
route             Route task to optimal agent using learned patterns
explain           Explain routing decision with transparency
pretrain          Bootstrap intelligence from repository (4-step pipeline + embeddings)
build-agents      Generate optimized agent configs from pretrain data
metrics           View learning metrics dashboard
transfer          Transfer patterns via IPFS registry or from another project
list              List all registered hooks
worker            Background worker management (12 workers)
progress          Check v1 implementation progress
statusline        Generate dynamic statusline for Claude Code display
coverage-route    Route tasks based on test coverage gaps
coverage-suggest  Suggest coverage improvements for a path
coverage-gaps     List all coverage gaps with priorities
token-optimize    Token optimization (30-50% savings)
model-route       Route to optimal model (haiku/sonnet/opus)
model-outcome     Record model routing outcome
model-stats       View model routing statistics
intelligence      RuVector intelligence system (trajectory, patterns, stats)
notify            Send notification with level and message
worker list       List all 12 background workers
worker dispatch   Dispatch a specific worker
worker status     Check worker status
worker detect     Detect worker triggers from a prompt
worker cancel     Cancel a running worker
```

## Real MCP Tools

- `mcp__monomind__hooks_pre_edit` / `hooks_post_edit`
- `mcp__monomind__hooks_pre_command` / `hooks_post_command`
- `mcp__monomind__hooks_pre_task` / `hooks_post_task`
- `mcp__monomind__hooks_session_end` / `hooks_session_restore`
- `mcp__monomind__hooks_route` / `hooks_explain`
- `mcp__monomind__hooks_pretrain` / `hooks_build_agents`
- `mcp__monomind__hooks_metrics` / `hooks_transfer`
- `mcp__monomind__hooks_intelligence` / `hooks_notify`
- `mcp__monomind__hooks_worker_list` / `hooks_worker_dispatch` / etc.
