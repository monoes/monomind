---
name: verify-check
description: Verify code quality, security, and correctness using real MCP tools — AI defence scanning, neural pattern analysis, and system health checks
---

# Verify Check

Run verification checks on code, tasks, or agent outputs using real MCP analysis tools.

## How to Invoke

```
Skill("verify:check")
```

---

## What to Verify

| Area | MCP Tools |
|------|-----------|
| Security vulnerabilities | `aidefence_scan`, `aidefence_is_safe`, `aidefence_analyze` |
| Pattern correctness | `neural_patterns`, `agentdb_pattern_search` |
| System integrity | `agentdb_health`, `system_health` |
| Memory consistency | `memory_search`, `memory_stats` |
| Performance regressions | `performance_report`, `performance_bottleneck` |

## Security Verification

```javascript
// Scan content for security issues
mcp__monomind__aidefence_scan({ content: "file content or task output" })

// Check if content is safe
mcp__monomind__aidefence_is_safe({ content: "content to check" })

// Deep analysis with context
mcp__monomind__aidefence_analyze({ content: "task output or code change" })

// Check for PII exposure
mcp__monomind__transfer_detect_pii({ content: "content to check" })
```

## Pattern Verification

```javascript
// Check stored patterns for this type of task
mcp__monomind__agentdb_pattern_search({ query: "task or code description", limit: 5 })

// Compare with known good patterns
mcp__monomind__neural_patterns({ action: "analyze", query: "task type" })

// Predict expected routing for the task
mcp__monomind__neural_predict({ input: "task description" })
```

## System Health Verification

```javascript
// AgentDB memory integrity
mcp__monomind__agentdb_health({})

// Full system health
mcp__monomind__system_health({})

// Performance snapshot
mcp__monomind__performance_report({ format: "detailed" })
```

## Code Verification Workflow

Run checks in parallel for speed:

```javascript
// Batch all checks at once
mcp__monomind__aidefence_scan({ content: "code or output" })
mcp__monomind__agentdb_health({})
mcp__monomind__system_health({})
mcp__monomind__performance_bottleneck({ component: "all" })
```

Then synthesize:
- **Pass** — no security issues, healthy system, no performance regressions
- **Review** — low-confidence patterns, minor warnings
- **Fail** — security vulnerabilities found, system degraded

## Git-Based Code Review

For verifying code changes, use git and standard tools:

```bash
# Check what changed
git diff HEAD~1

# Run tests against changed files
npm test -- --testPathPattern "changed-file"

# TypeScript type check
npx tsc --noEmit
```

## Related Skills

- `truth:start` — Full system reliability assessment
- `swarm:swarm-analysis` — Post-swarm run analysis
- `security-hardening` — Comprehensive security hardening workflow
