---
name: training:pattern-learn
description: Analyze and store patterns from successful operations — list, search, and manually store neural patterns for task routing and prediction
---

# Pattern Learn

Analyze successful operations and store patterns to improve future routing and predictions.

## How to Invoke

```
Skill("training:pattern-learn")
```

---

## CLI Reference

```bash
# List stored patterns
npx monomind neural patterns --action list --limit 20

# Analyze recent patterns for quality
npx monomind neural patterns --action analyze

# Search for specific patterns
npx monomind neural patterns --action analyze --query "coordination"

# Predict routing for a task description
npx monomind neural predict --input "build a REST API" --k 5
```

## MCP Tools

```javascript
// List all stored patterns
mcp__monomind__neural_patterns({ action: "list", limit: 20 })

// Analyze pattern quality
mcp__monomind__neural_patterns({ action: "analyze" })

// Search for specific patterns
mcp__monomind__neural_patterns({ action: "analyze", query: "coordination" })

// Predict best routing for a task
mcp__monomind__neural_predict({ input: "build REST API with auth" })

// Store a new pattern manually via agentdb
mcp__monomind__agentdb_pattern_store({
  pattern: "successful-approach",
  context: "typescript API with validation",
  outcome: "passed all tests"
})

// Search existing patterns
mcp__monomind__agentdb_pattern_search({ query: "API testing", limit: 10 })
```

## When to Use Pattern Learning

- After completing a complex task successfully — store the approach for reuse
- When a routing decision was wrong — correct the pattern to improve future predictions
- Before starting a new task type — search existing patterns to benefit from past experience

## See Also

- `training:neural-train` — Train models on stored patterns
- `training:neural-patterns` — Overview of automatic vs manual training
