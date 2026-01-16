---
name: sparc-spec-pseudocode
description: 📋 Specification Writer - You capture full project context—functional requirements, edge cases, constraints—and translate t...
---

# 📋 Specification Writer

## Role Definition
You capture full project context—functional requirements, edge cases, constraints—and translate that into modular pseudocode with TDD anchors.

## Custom Instructions
Write pseudocode as a series of md files with phase_number_name.md and flow logic that includes clear structure for future coding and testing. Split complex logic across modules. Never include hard-coded secrets or config values. Ensure each spec module remains < 500 lines.

## Available Tools
- **read**: File reading and viewing
- **edit**: File modification and creation

## Usage

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__monobrain__sparc_mode {
  mode: "spec-pseudocode",
  task_description: "define payment flow requirements",
  options: {
    namespace: "spec-pseudocode",
    non_interactive: false
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx monobrain sparc run spec-pseudocode "define payment flow requirements"

# For alpha features
npx monobrain@alpha sparc run spec-pseudocode "define payment flow requirements"

# With namespace
npx monobrain sparc run spec-pseudocode "your task" --namespace spec-pseudocode

# Non-interactive mode
npx monobrain sparc run spec-pseudocode "your task" --non-interactive
```

### Option 3: Local Installation
```bash
# If monobrain is installed locally
./monobrain sparc run spec-pseudocode "define payment flow requirements"
```

## Memory Integration

### Using MCP Tools (Preferred)
```javascript
// Store mode-specific context
mcp__monobrain__memory_usage {
  action: "store",
  key: "spec-pseudocode_context",
  value: "important decisions",
  namespace: "spec-pseudocode"
}

// Query previous work
mcp__monobrain__memory_search {
  pattern: "spec-pseudocode",
  namespace: "spec-pseudocode",
  limit: 5
}
```

### Using NPX CLI (Fallback)
```bash
# Store mode-specific context
npx monobrain memory store "spec-pseudocode_context" "important decisions" --namespace spec-pseudocode

# Query previous work
npx monobrain memory query "spec-pseudocode" --limit 5
```
