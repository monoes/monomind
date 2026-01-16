# SPARC Coder Mode

## Purpose
Autonomous code generation with batch file operations.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__monobrain__sparc_mode {
  mode: "coder",
  task_description: "implement user authentication",
  options: {
    test_driven: true,
    parallel_edits: true
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx monobrain sparc run coder "implement user authentication"

# For alpha features
npx monobrain@alpha sparc run coder "implement user authentication"
```

### Option 3: Local Installation
```bash
# If monobrain is installed locally
./monobrain sparc run coder "implement user authentication"
```

## Core Capabilities
- Feature implementation
- Code refactoring
- Bug fixes
- API development
- Algorithm implementation

## Batch Operations
- Parallel file creation
- Concurrent code modifications
- Batch import updates
- Test file generation
- Documentation updates

## Code Quality
- ES2022 standards
- Type safety with TypeScript
- Comprehensive error handling
- Performance optimization
- Security best practices
