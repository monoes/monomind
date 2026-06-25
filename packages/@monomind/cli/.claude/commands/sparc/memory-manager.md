---
name: sparc:memory-manager
description: Memory Manager - Knowledge management with Memory tools for persistent insights. Organizes, retrieves, and maintains cross-session project context.
---

# SPARC Memory Manager Mode

## Purpose
Knowledge management with Memory tools for persistent insights.

## How to Invoke

In Claude Code, load this mode as a skill:
```
Skill("sparc:memory-manager")
```

## Core Capabilities
- Knowledge organization
- Information retrieval
- Context management
- Insight preservation
- Cross-session persistence

## Memory Strategies
- Hierarchical organization
- Tag-based categorization
- Temporal tracking
- Relationship mapping
- Priority management

## Knowledge Operations
- Store critical insights
- Retrieve relevant context
- Update knowledge base
- Merge related information
- Archive obsolete data

## Real Memory Tools

```javascript
// Store context
mcp__monomind__memory_store({ key: "...", value: "...", namespace: "..." })

// Search stored knowledge
mcp__monomind__memory_search({ query: "...", namespace: "...", limit: 10 })

// List entries
mcp__monomind__memory_list({ namespace: "..." })
```

```bash
# CLI equivalents
npx monomind memory store "key" "value" --namespace ns
npx monomind memory search --query "term" --namespace ns
npx monomind memory list --namespace ns
```
