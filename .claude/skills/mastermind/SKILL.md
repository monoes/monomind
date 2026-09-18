---
name: mastermind
description: Use when a request may need a Mastermind workflow such as planning, review, debugging, research, execution, organization work, or memory.
---

# Mastermind Router

Load only the workflow that matches the request:

- `mastermind-idea` to shape a raw prompt into a stated problem and options.
- `mastermind-design` before building a feature — this is a gate, not a suggestion.
- `mastermind-plan` before multi-file implementation.
- `mastermind-execute` for a written plan.
- `mastermind-review` for audits and critiques.
- `mastermind-debug` for failures or unexpected behavior.
- `mastermind-research` for open questions.
- `mastermind-org` for organization lifecycle work.
- `mastermind-memory` for persistent knowledge.

**For build/feature work, the gates are mandatory and ordered:** idea → design → plan →
execute → review. The full routing table for the other 20+ Mastermind workflows lives in
`.claude/commands/mastermind-master.md`; consult it before concluding that no workflow applies.

Use Monograph before broad repository search when the platform exposes the
Monomind MCP server. Without native skills, run
`monomind mastermind run <skill> --print` and follow the printed procedure.
Platform tool mappings are in [references/](references/).
