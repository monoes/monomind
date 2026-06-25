---
name: sparc:sparc-modes
description: SPARC Modes Overview - All 32 SPARC methodology modes with purpose and invocation guide. Entry point for selecting the right specialist mode.
---

# SPARC Modes Overview

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) is a development methodology with 32 specialized Claude Code skill modes. Each mode is invoked via `Skill("sparc:<mode>")`.

## How to Use SPARC Modes

Load any mode in Claude Code:
```
Skill("sparc:<mode-name>")
```

For the SPARC orchestrator (main entry point):
```
Skill("sparc:sparc")
```


## Available Modes

### Core Orchestration
| Mode | Skill | Purpose |
|------|-------|---------|
| sparc | `sparc:sparc` | SPARC orchestrator — breaks tasks into delegated subtasks |
| orchestrator | `sparc:orchestrator` | Multi-agent task coordination |
| ask | `sparc:ask` | Task formulation guide — choose the right mode |
| swarm-coordinator | `sparc:swarm-coordinator` | Specialized swarm management |
| workflow-manager | `sparc:workflow-manager` | Process automation |
| batch-executor | `sparc:batch-executor` | Parallel task execution |

### Development
| Mode | Skill | Purpose |
|------|-------|---------|
| code | `sparc:code` | Auto-coder: clean modular implementation |
| coder | `sparc:coder` | Batch file code generation |
| architect | `sparc:architect` | System design and API contracts |
| spec-pseudocode | `sparc:spec-pseudocode` | Requirements and pseudocode specs |
| tdd | `sparc:tdd` | Test-driven development cycle |
| integration | `sparc:integration` | Merge outputs into production system |
| devops | `sparc:devops` | CI/CD, deployment, infrastructure |
| supabase-admin | `sparc:supabase-admin` | Supabase DB, auth, storage management |
| mcp | `sparc:mcp` | External API and MCP integration |

### Review and Quality
| Mode | Skill | Purpose |
|------|-------|---------|
| reviewer | `sparc:reviewer` | Code review: correctness, security, patterns |
| security-review | `sparc:security-review` | Security audit: secrets, exposure, CVEs |
| tester | `sparc:tester` | Comprehensive testing (unit, E2E, perf) |
| debugger | `sparc:debugger` | Systematic debugging with TodoWrite |
| debug | `sparc:debug` | Runtime bug isolation and fix |

### Analysis and Research
| Mode | Skill | Purpose |
|------|-------|---------|
| researcher | `sparc:researcher` | Deep research with WebSearch/WebFetch |
| analyzer | `sparc:analyzer` | Code and data analysis with batch ops |
| optimizer | `sparc:optimizer` | Performance optimization cycle |
| post-deployment-monitoring-mode | `sparc:post-deployment-monitoring-mode` | Production observability |
| refinement-optimization-mode | `sparc:refinement-optimization-mode` | Refactor and optimize |

### Creative and Support
| Mode | Skill | Purpose |
|------|-------|---------|
| designer | `sparc:designer` | UI/UX design and component architecture |
| innovator | `sparc:innovator` | Creative problem solving |
| documenter | `sparc:documenter` | Batch documentation generation |
| docs-writer | `sparc:docs-writer` | Markdown docs and guides |
| memory-manager | `sparc:memory-manager` | Knowledge management |
| tutorial | `sparc:tutorial` | SPARC onboarding and education |

## Common Workflows

### Full Development Cycle
```
1. Skill("sparc:spec-pseudocode")  → define requirements
2. Skill("sparc:architect")         → design system
3. Skill("sparc:code")              → implement
4. Skill("sparc:tdd")               → test-driven
5. Skill("sparc:security-review")   → security audit
6. Skill("sparc:integration")       → integrate
7. Skill("sparc:docs-writer")       → document
8. Skill("sparc:devops")            → deploy
9. Skill("sparc:post-deployment-monitoring-mode") → monitor
```

### Research and Innovation
```
1. Skill("sparc:researcher")   → gather information
2. Skill("sparc:innovator")    → propose solutions
3. Skill("sparc:architect")    → design approach
4. Skill("sparc:documenter")   → document findings
```

### Bug Fix
```
1. Skill("sparc:debug")        → isolate issue
2. Skill("sparc:tdd")          → write failing test
3. Skill("sparc:code")         → implement fix
4. Skill("sparc:reviewer")     → review changes
```

## Multi-Agent Coordination

For complex multi-agent orchestration, combine with real swarm tools:

```javascript
// Initialize swarm
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 8, strategy: "specialized" })

// Check status
mcp__monomind__swarm_status({ swarmId: "current" })

// Coordinate tasks
mcp__monomind__coordination_orchestrate({ task: "feature development", strategy: "parallel" })
```
