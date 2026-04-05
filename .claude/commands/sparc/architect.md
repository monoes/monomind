# SPARC Architect Mode

## Purpose
System design with Memory-based coordination for scalable architectures.

## Activation

### Option 1: Using MCP Tools (Preferred in Claude Code)
```javascript
mcp__monobrain__sparc_mode {
  mode: "architect",
  task_description: "design microservices architecture",
  options: {
    detailed: true,
    memory_enabled: true
  }
}
```

### Option 2: Using NPX CLI (Fallback when MCP not available)
```bash
# Use when running from terminal or MCP tools unavailable
npx monobrain sparc run architect "design microservices architecture"

# For alpha features
npx monobrain@alpha sparc run architect "design microservices architecture"
```

### Option 3: Local Installation
```bash
# If monobrain is installed locally
./monobrain sparc run architect "design microservices architecture"
```

## Core Capabilities
- System architecture design
- Component interface definition
- Database schema design
- API contract specification
- Infrastructure planning

## Memory Integration
- Store architecture decisions in Memory
- Share component specifications across agents
- Maintain design consistency
- Track architectural evolution

## Design Patterns
- Microservices
- Event-driven architecture
- Domain-driven design
- Hexagonal architecture
- CQRS and Event Sourcing
