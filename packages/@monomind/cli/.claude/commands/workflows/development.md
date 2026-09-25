---
name: workflows:development
description: Development workflow pattern — plan, implement, test, and review with Task-tool agents in Claude Code, or as a dev-team org via npx monomind org
---

# Development Workflow Coordination

Structure multi-agent development work. The CLI has no `workflow` command; run the stages with the Task tool, or as a `dev-team` org.

## How to Invoke

```
Skill("workflows:development")
```

---

## Stages

1. **Planning** — requirements, architecture decisions (`planner`)
2. **Implementation** — code (`coder`)
3. **Testing** — unit and integration tests (`tester`, in parallel with implementation where the contract is known)
4. **Review** — quality and security (`reviewer`, `Security Engineer`)
5. **Integration** — wire the pieces together, run the full build and test suite

## In the Conversation (Task Tool)

```javascript
// Stage 1
Task({ subagent_type: "planner", prompt: "Plan a REST API with JWT auth: endpoints, data model, files to touch." })

// Stages 2-3, one message
Task({ subagent_type: "coder",  prompt: "Implement the plan in src/api/ ..." })
Task({ subagent_type: "tester", prompt: "Write tests for the endpoints defined in the plan ..." })

// Stage 4, one message
Task({ subagent_type: "reviewer",          prompt: "Review the diff for correctness and maintainability." })
Task({ subagent_type: "Security Engineer", prompt: "Review the auth code for vulnerabilities." })
```

Optional coordination and tracking:

```bash
npx monomind monoswarm init --topology hierarchical --max-agents 8
npx monomind hooks pre-task --description "Build REST API with auth" --task-id rest-api
npx monomind hooks post-task --task-id rest-api --success true
npx monomind memory store --key "dev-pattern-rest-api" \
  --value "JWT auth + Express + Zod validation worked well" --namespace patterns
```

## As an Org

```bash
npx monomind org create rest-api --template dev-team --goal "Build REST API with auth"
npx monomind org run rest-api --dry-run
npx monomind org run rest-api
npx monomind org report rest-api
```

The `dev-team` template has tech-lead, developer, code-reviewer, and qa roles.

## What Claude Code Actually Does

1. **Read/Write/Edit** — create and modify files
2. **Bash** — run tests, builds, type checks
3. **TodoWrite** — track stages
4. **Task** — spawn parallel agents

## Related Skills

- `workflows:workflow-execute` — Running workflows
- `monoswarm:development` — Monoswarm-based development coordination
- `mastermind-plan` / `mastermind-execute` — Plan, then execute step by step
