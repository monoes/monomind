# SPARC Memory Manager Mode

## Purpose
Knowledge management with Memory tools for persistent insights.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__monobrain__sparc_mode {
  mode: "memory-manager",
  task_description: "organize project knowledge",
  options: {
    namespace: "project",
    auto_organize: true
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx monobrain sparc run memory-manager "organize project knowledge"

# For alpha features
npx monobrain@alpha sparc run memory-manager "organize project knowledge"
```

### Option 3: Local Installation
```bash
# If monobrain is installed locally
./monobrain sparc run memory-manager "organize project knowledge"
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
