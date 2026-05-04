---
name: training:specialization
description: Agent specialization training — spawn capability-specific agents for TypeScript, React, security, and other domains; track specialization progress
---

# Agent Specialization Training

Train and spawn agents that specialize in specific domains for better task performance.

## How to Invoke

```
Skill("training:specialization")
```

---

## Spawning Specialized Agents

```javascript
// Spawn a React/TypeScript specialist
mcp__monomind__agent_spawn({
  type: "coder",
  capabilities: ["react", "typescript", "testing"],
  name: "React Specialist"
})

// Spawn a security-focused agent
mcp__monomind__agent_spawn({
  type: "security-architect",
  capabilities: ["security-audit", "vulnerability-detection", "cve-remediation"]
})

// Spawn a database specialist
mcp__monomind__agent_spawn({
  type: "analyst",
  capabilities: ["sql", "nosql", "query-optimization", "schema-design"]
})
```

```bash
npx monomind agent spawn --type coder --capabilities "react,typescript,testing"
npx monomind agent list
```

## How Specialization Builds

Agents accumulate expertise through:
- Successful edits to files of a given type (`.ts`, `.py`, `.go`)
- Pattern matching from stored neural patterns
- Hooks feedback from `post-edit` and `post-task` results

The hooks intelligence system records what worked and feeds it back into agent routing.

## Specialization by File Type

| Extension | Auto-specialization |
|-----------|-------------------|
| `.ts` / `.tsx` | TypeScript, React patterns |
| `.py` | Python idioms, type hints |
| `.go` | Go concurrency, interfaces |
| `.rs` | Rust borrowing, ownership |
| `.sql` | Query optimization, schema |

## Checking Agent Specializations

```javascript
// List agents with their capabilities
mcp__monomind__agent_list({})

// Agent status detail
mcp__monomind__agent_status({ agentId: "coder-001" })
```

```bash
npx monomind agent list
npx monomind agent status --id coder-001
```

## Training New Specializations

```javascript
// Train neural patterns for a specific domain
mcp__monomind__neural_train({ patternType: "optimization", epochs: 100 })

// Store a domain-specific pattern for future reuse
mcp__monomind__agentdb_pattern_store({
  pattern: "react-component-pattern",
  context: "TypeScript functional components with hooks",
  outcome: "clean, testable components"
})
```
