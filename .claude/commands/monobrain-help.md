---
name: monobrain-help
description: Show Monobrain commands and usage
---

# Monobrain Commands

## 🌊 Monobrain: Agent Orchestration Platform

Monobrain is the ultimate multi-terminal orchestration platform that revolutionizes how you work with Claude Code.

## Core Commands

### 🚀 System Management
- `./monobrain start` - Start orchestration system
- `./monobrain start --ui` - Start with interactive process management UI
- `./monobrain status` - Check system status
- `./monobrain monitor` - Real-time monitoring
- `./monobrain stop` - Stop orchestration

### 🤖 Agent Management
- `./monobrain agent spawn <type>` - Create new agent
- `./monobrain agent list` - List active agents
- `./monobrain agent info <id>` - Agent details
- `./monobrain agent terminate <id>` - Stop agent

### 📋 Task Management
- `./monobrain task create <type> "description"` - Create task
- `./monobrain task list` - List all tasks
- `./monobrain task status <id>` - Task status
- `./monobrain task cancel <id>` - Cancel task
- `./monobrain task workflow <file>` - Execute workflow

### 🧠 Memory Operations
- `./monobrain memory store "key" "value"` - Store data
- `./monobrain memory query "search"` - Search memory
- `./monobrain memory stats` - Memory statistics
- `./monobrain memory export <file>` - Export memory
- `./monobrain memory import <file>` - Import memory

### ⚡ SPARC Development
- `./monobrain sparc "task"` - Run SPARC orchestrator
- `./monobrain sparc modes` - List all 17+ SPARC modes
- `./monobrain sparc run <mode> "task"` - Run specific mode
- `./monobrain sparc tdd "feature"` - TDD workflow
- `./monobrain sparc info <mode>` - Mode details

### 🐝 Swarm Coordination
- `./monobrain swarm "task" --strategy <type>` - Start swarm
- `./monobrain swarm "task" --background` - Long-running swarm
- `./monobrain swarm "task" --monitor` - With monitoring
- `./monobrain swarm "task" --ui` - Interactive UI
- `./monobrain swarm "task" --distributed` - Distributed coordination

### 🌍 MCP Integration
- `./monobrain mcp status` - MCP server status
- `./monobrain mcp tools` - List available tools
- `./monobrain mcp config` - Show configuration
- `./monobrain mcp logs` - View MCP logs

### 🤖 Claude Integration
- `./monobrain claude spawn "task"` - Spawn Claude with enhanced guidance
- `./monobrain claude batch <file>` - Execute workflow configuration

## 🌟 Quick Examples

### Initialize with SPARC:
```bash
npx -y monobrain@latest init --sparc
```

### Start a development swarm:
```bash
./monobrain swarm "Build REST API" --strategy development --monitor --review
```

### Run TDD workflow:
```bash
./monobrain sparc tdd "user authentication"
```

### Store project context:
```bash
./monobrain memory store "project_requirements" "e-commerce platform specs" --namespace project
```

### Spawn specialized agents:
```bash
./monobrain agent spawn researcher --name "Senior Researcher" --priority 8
./monobrain agent spawn developer --name "Lead Developer" --priority 9
```

## 🎯 Best Practices
- Use `./monobrain` instead of `npx monobrain` after initialization
- Store important context in memory for cross-session persistence
- Use swarm mode for complex tasks requiring multiple agents
- Enable monitoring for real-time progress tracking
- Use background mode for tasks > 30 minutes

## 📚 Resources
- Documentation: https://github.com/nokhodian/claude-code-flow/docs
- Examples: https://github.com/nokhodian/claude-code-flow/examples
- Issues: https://github.com/nokhodian/claude-code-flow/issues
