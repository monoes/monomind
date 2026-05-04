---
name: verify-start
description: Verification skill overview — guides running quality, security, and correctness checks using real MCP tools and git-based workflows
---

# Verify — Quality and Correctness Checks

Run targeted verification checks on code, agent outputs, and system state.

## How to Invoke

```
Skill("verify:start")
```

Then describe what to verify:
> "Verify the last agent output for security issues."
> "Check system health before deploying."
> "Verify the code changes in this PR are safe."

---

## Verification Areas

| Area | Skill | What it checks |
|------|-------|---------------|
| Code security | `verify:check` | AI defence scan, PII detection |
| Pattern quality | `verify:check` | Neural pattern confidence, routing accuracy |
| System health | `truth:start` | MCP status, AgentDB health, performance |
| Agent outputs | `verify:check` | Task correctness against stored patterns |

## Quick Checks

### Security Scan

```javascript
mcp__monomind__aidefence_scan({ content: "output or code to verify" })
mcp__monomind__aidefence_is_safe({ content: "content" })
```

### System Integrity

```javascript
mcp__monomind__agentdb_health({})
mcp__monomind__system_health({})
mcp__monomind__system_status({})
```

### Pattern Confidence

```javascript
mcp__monomind__neural_status({ verbose: true })
mcp__monomind__neural_patterns({ action: "analyze" })
```

### Performance Baseline

```javascript
mcp__monomind__performance_report({ format: "detailed" })
mcp__monomind__performance_bottleneck({ component: "all" })
```

## Code Change Verification

For verifying code changes before committing or merging:

```bash
# Type safety
npx tsc --noEmit

# Tests
npm test

# Lint
npm run lint

# Diff review
git diff HEAD~1 --stat
```

## Post-Task Verification

After a swarm or agent task completes, verify outputs:

```javascript
// 1. Check agent health post-task
mcp__monomind__agent_health({})

// 2. Scan output for security issues
mcp__monomind__aidefence_analyze({ content: "task summary or generated code" })

// 3. Store verified pattern for future use
mcp__monomind__agentdb_pattern_store({
  pattern: "verified-approach",
  context: "task type and context",
  outcome: "success"
})
```

## Related Skills

- `verify:check` — Targeted verification checks with MCP tools
- `truth:start` — Full system reliability assessment
- `hooks:post-task` — Automatic post-task verification via hooks
- `security-hardening` — Comprehensive security workflows
