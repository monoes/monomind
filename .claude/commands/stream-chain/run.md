---
name: stream-chain:run
description: Execute custom stream chains where you define the prompt sequence. Each step receives the full output of the previous step as context.
---

# Stream-Chain Run Mode

Execute custom multi-step workflows with your own prompt sequence. Each step's full output becomes context for the next.

## How to Invoke

In Claude Code, activate run mode:
```
Skill("stream-chain:run")
```

Then provide your chain directly:
> "Run a stream chain:
> 1. Write a sorting function
> 2. Add tests for it
> 3. Optimize it for performance"

---

## How Context Flows

Each step receives the complete output of all previous steps:

```
Step 1: "Write a sorting function"
Output: [function code]

Step 2 receives:
  Previous output: [function code]
  Task: "Add comprehensive tests"

Step 3 receives:
  Previous output: [function + tests]
  Task: "Optimize for performance"
```

---

## Examples

### Basic Development Chain

> "Stream chain:
> 1. Write a user authentication function
> 2. Add input validation and error handling
> 3. Create unit tests with edge cases"

### Security Audit Workflow

> "Stream chain for the `src/auth/` module:
> 1. Analyze for security vulnerabilities
> 2. Categorize issues by severity (critical/high/medium/low)
> 3. Propose fixes with implementation priority
> 4. Generate security test cases"

### Code Refactoring Chain

> "Stream chain:
> 1. Identify code smells in `src/` directory
> 2. Create refactoring plan with specific changes
> 3. Apply refactoring to top 3 priority items
> 4. Verify refactored code maintains original behavior"

### Data Processing Pipeline

> "Stream chain:
> 1. Extract data from API responses in `handlers/`
> 2. Transform data into normalized format
> 3. Validate data against schema
> 4. Generate data quality report"

### Code Migration Workflow

> "Stream chain for migrating Vue 2 to Vue 3:
> 1. Analyze codebase dependencies and breaking changes
> 2. Create migration plan with risk assessment
> 3. Generate modernized code for high-priority components
> 4. Create migration tests
> 5. Document migration steps and rollback procedures"

---

## Best Practices

### 1. Clear, Specific Prompts

Good:
> "Analyze `auth.ts` for SQL injection vulnerabilities"

Avoid:
> "Check security"

### 2. Logical Progression

Build on previous outputs:
1. Identify the problem
2. Analyze root causes
3. Design solution
4. Implement solution
5. Verify implementation

### 3. Include Verification Steps

> "Stream chain:
> 1. Implement feature X
> 2. Write tests for feature X
> 3. Verify tests pass and cover edge cases"

### 4. Iterative Refinement

> "Stream chain:
> 1. Generate initial implementation
> 2. Review and identify issues
> 3. Refine based on issues found
> 4. Final quality check"

---

## Multi-Agent Integration

For complex chains, combine with swarm coordination:

```javascript
// Initialize swarm first
mcp__monomind__swarm_init({ topology: "hierarchical", maxAgents: 4, strategy: "specialized" })
```

Then direct the stream chain:
> "With our 4-agent swarm, run a stream chain:
> 1. Research: best practices for API design
> 2. Design: REST API with discovered patterns
> 3. Implement: API endpoints with validation
> 4. Review: final quality check and documentation"

## Memory Integration

Use memory tools to persist chain results for future sessions:

```javascript
mcp__monomind__memory_store({
  key: "stream-chain-result",
  value: "summary of findings",
  namespace: "stream-chain"
})
```

---

## See Also
- `stream-chain:pipeline` — predefined pipelines for common workflows
- `stream-chain` — full stream-chain skill with advanced patterns
