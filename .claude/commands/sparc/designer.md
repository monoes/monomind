# SPARC Designer Mode

## Purpose
UI/UX design with Memory coordination for consistent experiences.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__monobrain__sparc_mode {
  mode: "designer",
  task_description: "create dashboard UI",
  options: {
    design_system: true,
    responsive: true
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx monobrain sparc run designer "create dashboard UI"

# For alpha features
npx monobrain@alpha sparc run designer "create dashboard UI"
```

### Option 3: Local Installation
```bash
# If monobrain is installed locally
./monobrain sparc run designer "create dashboard UI"
```

## Core Capabilities
- Interface design
- Component architecture
- Design system creation
- Accessibility planning
- Responsive layouts

## Design Process
- User research insights
- Wireframe creation
- Component design
- Interaction patterns
- Design token management

## Memory Coordination
- Store design decisions
- Share component specs
- Maintain consistency
- Track design evolution
