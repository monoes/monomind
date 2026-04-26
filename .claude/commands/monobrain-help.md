---
name: monomind-help
description: Show Monomind commands and usage
---

# Monomind Commands

## 🌊 Monomind: Agent Orchestration Platform

Monomind is the ultimate multi-terminal orchestration platform that revolutionizes how you work with Claude Code.

## Core Commands

### 🚀 System Management
- `./monomind start` - Start orchestration system
- `./monomind start --ui` - Start with interactive process management UI
- `./monomind status` - Check system status
- `./monomind monitor` - Real-time monitoring
- `./monomind stop` - Stop orchestration

### 🤖 Agent Management
- `./monomind agent spawn <type>` - Create new agent
- `./monomind agent list` - List active agents
- `./monomind agent info <id>` - Agent details
- `./monomind agent terminate <id>` - Stop agent

### 📋 Task Management
- `./monomind task create <type> "description"` - Create task
- `./monomind task list` - List all tasks
- `./monomind task status <id>` - Task status
- `./monomind task cancel <id>` - Cancel task
- `./monomind task workflow <file>` - Execute workflow

### 🧠 Memory Operations
- `./monomind memory store "key" "value"` - Store data
- `./monomind memory query "search"` - Search memory
- `./monomind memory stats` - Memory statistics
- `./monomind memory export <file>` - Export memory
- `./monomind memory import <file>` - Import memory

### ⚡ SPARC Development
- `./monomind sparc "task"` - Run SPARC orchestrator
- `./monomind sparc modes` - List all 17+ SPARC modes
- `./monomind sparc run <mode> "task"` - Run specific mode
- `./monomind sparc tdd "feature"` - TDD workflow
- `./monomind sparc info <mode>` - Mode details

### 🐝 Swarm Coordination
- `./monomind swarm "task" --strategy <type>` - Start swarm
- `./monomind swarm "task" --background` - Long-running swarm
- `./monomind swarm "task" --monitor` - With monitoring
- `./monomind swarm "task" --ui` - Interactive UI
- `./monomind swarm "task" --distributed` - Distributed coordination

### 🌍 MCP Integration
- `./monomind mcp status` - MCP server status
- `./monomind mcp tools` - List available tools
- `./monomind mcp config` - Show configuration
- `./monomind mcp logs` - View MCP logs

### 🤖 Claude Integration
- `./monomind claude spawn "task"` - Spawn Claude with enhanced guidance
- `./monomind claude batch <file>` - Execute workflow configuration

## 🌟 Quick Examples

### Initialize with SPARC:
```bash
npx -y monomind@latest init --sparc
```

### Start a development swarm:
```bash
./monomind swarm "Build REST API" --strategy development --monitor --review
```

### Run TDD workflow:
```bash
./monomind sparc tdd "user authentication"
```

### Store project context:
```bash
./monomind memory store "project_requirements" "e-commerce platform specs" --namespace project
```

### Spawn specialized agents:
```bash
./monomind agent spawn researcher --name "Senior Researcher" --priority 8
./monomind agent spawn developer --name "Lead Developer" --priority 9
```

## 🎯 Best Practices
- Use `./monomind` instead of `npx monomind` after initialization
- Store important context in memory for cross-session persistence
- Use swarm mode for complex tasks requiring multiple agents
- Enable monitoring for real-time progress tracking
- Use background mode for tasks > 30 minutes

## 📚 Resources
- Documentation: https://github.com/nokhodian/claude-code-flow/docs
- Examples: https://github.com/nokhodian/claude-code-flow/examples
- Issues: https://github.com/nokhodian/claude-code-flow/issues
