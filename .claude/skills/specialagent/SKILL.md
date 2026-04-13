---
name: specialagent
description: Find the single best specialized agent (or swarm configuration) from the full 60+ agent roster for any given task — scoring by domain fit, then recommending which agents to use and in what roles
version: 1.0.0
triggers:
  - /specialagent
  - find best agent
  - which agent should i use
  - best agent for
  - recommend an agent
  - pick an agent
  - what agent
  - who should handle this
  - which specialist
  - what specialist
  - agent for this task
  - assign an agent
  - which swarm agent
tools:
  - Bash
---

# /specialagent — Find the Best Agent for Any Task

Analyzes the task and scores every agent in the roster, then recommends the optimal agent(s) to use — either solo or as a swarm configuration.

## How It Works

```
READ task → SCORE all agents → RANK by fit → RECOMMEND top pick + swarm config
```

## Agent Roster by Domain

Use this reference to score agents against the task:

### Development
| Agent | Best For |
|---|---|
| `sparc-coder` | TDD-first feature implementation, SPARC methodology |
| `coder` | General code generation and refactoring |
| `backend-dev` | APIs, databases, server-side patterns |
| `Frontend Developer` | React/Vue/Angular, UI implementation |
| `mobile-dev` | React Native, iOS/Android cross-platform |
| `ml-developer` | ML model training, deployment, pipelines |
| `Rapid Prototyper` | Fast POC/MVP, proof-of-concept |
| `base-template-generator` | Boilerplate, starter configs, scaffolding |

### Testing & QA
| Agent | Best For |
|---|---|
| `tdd-london-swarm` | Mock-driven TDD, London school style |
| `API Tester` | REST/GraphQL API validation, performance |
| `production-validator` | Deployment readiness, smoke tests |
| `Evidence Collector` | Screenshot-backed, visual proof QA |
| `agent-browser-testing` | Browser automation, UI walkthroughs, crawling |
| `Accessibility Auditor` | WCAG, screen reader, a11y testing |
| `Reality Checker` | Evidence-based certification, anti-fantasy QA |

### Code Review & Analysis
| Agent | Best For |
|---|---|
| `Code Reviewer` | Correctness, maintainability, security |
| `code-analyzer` | Code quality metrics, smells, complexity |
| `feature-dev:code-reviewer` | Bug detection, logic errors, CVEs |
| `superpowers:code-reviewer` | Major project step review vs plan |
| `Blockchain Security Auditor` | Smart contract security, exploit analysis |

### Architecture & Design
| Agent | Best For |
|---|---|
| `system-architect` | System design, patterns, technical decisions |
| `Software Architect` | DDD, bounded contexts, ADRs |
| `Backend Architect` | Scalable APIs, microservices, cloud |
| `Plan` | Implementation planning, step-by-step strategy |
| `UX Architect` | CSS systems, interaction design, spatial UI |
| `UI Designer` | Visual design systems, component libraries |

### Security
| Agent | Best For |
|---|---|
| `Security Engineer` | Threat modelling, secure code review |
| `security-auditor` | SOC 2, ISO 27001, HIPAA, PCI-DSS |
| `v1-security-architect` | CVE remediation, threat modelling |
| `Compliance Auditor` | Regulatory compliance audits |

### DevOps & Infrastructure
| Agent | Best For |
|---|---|
| `DevOps Automator` | CI/CD, infra automation, cloud ops |
| `SRE` | SLOs, error budgets, chaos engineering |
| `cicd-engineer` | GitHub Actions pipeline creation |
| `Incident Response Commander` | Prod incident management, post-mortems |

### Data & AI
| Agent | Best For |
|---|---|
| `Data Engineer` | ETL/ELT, Spark, dbt, lakehouse |
| `AI Engineer` | ML features, LLM integration, AI apps |
| `Database Optimizer` | Schema design, query tuning, indexes |
| `AI Data Remediation Engineer` | Self-healing data pipelines |

### Research & Documentation
| Agent | Best For |
|---|---|
| `sparc:researcher` | Parallel web search, academic + industry |
| `Explore` | Fast codebase exploration, pattern finding |
| `Trend Researcher` | Market intelligence, emerging trends |
| `Technical Writer` | API docs, README, tutorials |
| `api-docs` | OpenAPI/Swagger documentation |

### Swarm Coordination
| Agent | Best For |
|---|---|
| `hierarchical-coordinator` | Queen-led swarm, tight control |
| `mesh-coordinator` | Peer-to-peer distributed decisions |
| `adaptive-coordinator` | Dynamic topology switching |
| `task-orchestrator` | Task decomposition, result synthesis |
| `consensus-coordinator` | Byzantine fault-tolerant consensus |

## Scoring Algorithm

When activated, score each candidate agent against the task:

```
Score = Σ(keyword_hits) + domain_bonus + specificity_bonus

keyword_hits   = number of task keywords the agent's description matches
domain_bonus   = +3 if agent's primary domain matches task domain
specificity_bonus = +2 if agent is more specialized than a generic role
```

Pick the **top 3** by score. The winner is the primary recommendation.

## Output Format

```
TASK: <task summary>

🥇 PRIMARY AGENT: <agent-slug>
   Why: <1-2 sentences on fit>
   Invoke: Task({ subagent_type: "<slug>", prompt: "..." })

🥈 BACKUP: <agent-slug>
   Why: <brief reason>

🥉 ALTERNATE: <agent-slug>
   Why: <brief reason>

──────────────────────────────────────────────
SWARM CONFIGURATION (if task warrants multiple agents):

Topology: hierarchical | mesh | adaptive
Agents:
  - coordinator: <slug>    ← orchestrates
  - worker-1: <slug>       ← primary execution
  - worker-2: <slug>       ← secondary execution
  - reviewer: <slug>       ← validates output

npx monobrain swarm init --topology hierarchical --max-agents 4
```

## Rules

1. **Never pick a generic role** (`coder`, `tester`) when a specialized agent exists
2. **One agent for simple tasks** — don't recommend a swarm for a 2-line fix
3. **Swarm only when**: 3+ files, cross-domain work, or >30 min estimated effort
4. **Always explain WHY** — one sentence of reasoning per agent
5. **If unsure between two**, pick the more specialized one

## Examples

```
User: "add OAuth2 to our Express API"
→ Primary: backend-dev (API auth patterns)
→ Backup: Security Engineer (threat modelling)
→ Swarm: coordinator + backend-dev + tdd-london-swarm + Code Reviewer

User: "test the login page UI"
→ Primary: agent-browser-testing (browser automation, UI walkthroughs)
→ Backup: Evidence Collector (screenshot-backed QA)

User: "review the migration for SQL injection risks"
→ Primary: Security Engineer (secure code review)
→ Backup: Blockchain Security Auditor (exploit analysis — if Solidity)
→ Backup: Code Reviewer (general correctness)

User: "set up GitHub Actions for our monorepo"
→ Primary: cicd-engineer (GitHub Actions specialization)
→ Backup: DevOps Automator (broader infra automation)
```

## Activation Steps

1. Read the user's task carefully
2. Identify the domain: development / testing / security / devops / data / research / design
3. Score top 5 candidates from the roster above
4. Pick the winner and 2 backups
5. Decide: solo agent or swarm?
6. Output the recommendation in the format above
7. Ask if the user wants you to spawn the recommended agent now
