---
name: mastermind
description: Use when a request may need a Mastermind workflow such as planning, review, debugging, research, execution, organization work, or memory.
---

# Mastermind Router

Load only the workflow that matches the request:

- `mastermind-plan` before multi-file implementation.
- `mastermind-review` for audits and critiques.
- `mastermind-debug` for failures or unexpected behavior.
- `mastermind-research` for open questions.
- `mastermind-execute` for a written plan.
- `mastermind-org` for organization lifecycle work.
- `mastermind-memory` for persistent knowledge.

Use Monograph before broad repository search when the platform exposes the
Monomind MCP server. Without native skills, run
`monomind mastermind run <skill> --print` and follow the printed procedure.
Platform tool mappings are in [references/](references/).
# monomind:start skills:claude:mastermind
# Mastermind

Load only the workflow that matches the current task:
- `mastermind` — Route a request to the relevant Mastermind workflow.
- `mastermind-plan` — Write a detailed implementation plan before changing code.
- `mastermind-review` — Review code, content, strategy, or security work.
- `mastermind-debug` — Investigate a failure or unexpected behavior before fixing it.
- `mastermind-research` — Research an open question before making a decision.
- `mastermind-execute` — Execute a written implementation plan step by step.
- `mastermind-org` — Create, run, inspect, and manage a Mastermind organization.
- `mastermind-memory` — Store, retrieve, and maintain persistent organization knowledge.

If skills cannot be loaded natively, run `monomind mastermind run <skill> --print`.
# monomind:end skills:claude:mastermind
