---
name: automation:session-memory
---

# Cross-Session Memory

## Purpose
Maintain context and learnings across Claude Code sessions for continuous improvement.

## Memory Features

### 1. Automatic State Persistence
At session end, automatically saves:
- Active agents and specializations
- Task history and patterns
- Performance metrics
- Neural network weights
- Knowledge base updates

### 2. Session Restoration
```javascript
// Retrieve saved session state
mcp__monomind__memory_retrieve({
  key: "session-state",
  namespace: "sessions"
})

// Restore a named session
mcp__monomind__session_restore({
  sessionId: "sess-123"
})
```

**Fallback with npx:**
```bash
npx monomind hooks session-restore --id "sess-123"
```

### 3. Memory Types

**Project Memory:**
- File relationships
- Common edit patterns
- Testing approaches
- Build configurations

**Agent Memory:**
- Specialization levels
- Task success rates
- Optimization strategies
- Error patterns

**Performance Memory:**
- Bottleneck history
- Optimization results
- Token usage patterns
- Efficiency trends

### 4. Privacy & Control
```javascript
// List memory entries by namespace
mcp__monomind__memory_list({
  namespace: "sessions"
})

// Delete specific memory entry
mcp__monomind__memory_delete({
  key: "session-123",
  namespace: "sessions"
})

// Check memory stats
mcp__monomind__memory_stats({})
```

**Manual control:**
```bash
# List saved sessions
npx monomind session list

# Disable memory persistence
export MONOMIND_MEMORY_PERSIST=false
```

## Benefits
- Contextual awareness
- Cumulative learning
- Faster task completion
- Personalized optimization