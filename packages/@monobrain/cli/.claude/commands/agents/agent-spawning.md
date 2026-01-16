# agent-spawning

Guide to spawning agents with Claude Code's Task tool.

## Using Claude Code's Task Tool

**CRITICAL**: Always use Claude Code's Task tool for actual agent execution:

```javascript
// Spawn ALL agents in ONE message
Task("Researcher", "Analyze requirements...", "researcher")
Task("Coder", "Implement features...", "coder")
Task("Tester", "Create tests...", "tester")
```

## MCP Coordination Setup (Optional)

MCP tools are ONLY for coordination:
```javascript
mcp__monobrain__swarm_init { topology: "mesh" }
mcp__monobrain__agent_spawn { type: "researcher" }
```

## Best Practices
1. Always spawn agents concurrently
2. Use Task tool for execution
3. MCP only for coordination
4. Batch all operations
