---
name: mastermind-org
description: Use when creating, running, inspecting, or managing a Mastermind organization and its agents, tasks, or runtime state.
---

# Mastermind Organization

Use the `monomind org` commands as the portable organization control surface.

- Create or configure an organization with `monomind org create` or the platform's organization workflow.
- Run an organization once with `monomind org run <name>`.
- Host scheduled organizations with `monomind org serve`.
- Inspect status with `monomind org status [name]` and validate configuration with `monomind org validate [name]`.
- Stop a running organization with `monomind org stop <name>`.

Before changing organization configuration, inspect its current status and preserve the user's explicit goal, budget, and safety constraints. Use the platform's native task and agent interfaces when available; otherwise keep the CLI as the functional source of truth.

The org runtime does not read `<org>-issues.json`. Work is driven by the org definition's roles and goal plus an optional `--task` string.
