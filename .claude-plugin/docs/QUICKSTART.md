# 🚀 Monobrain Plugin - Quickstart Guide

Get started with Monobrain in 5 minutes!

---

## 📦 Installation

### Quick Install (Recommended)

In Claude Code:

```
/plugin add nokhodian/monobrain
/restart
```

### Local Installation

```bash
# Clone the repository
git clone https://github.com/nokhodian/monobrain.git
cd monobrain
```

Then in Claude Code:
```
/plugin add .
/restart
```

---

## ✅ Verify Installation

In Claude Code:

```
/plugin list
```

Look for `monobrain` in the active plugins.

Try a command:
```
/coordination-swarm-init
```

Or type `/` to see all 150+ commands.

---

## 🎯 Your First Swarm

### 1. Initialize a Swarm

In Claude Code, run:

```
/coordination-swarm-init
```

This creates a hierarchical swarm with:
- Automatic agent spawning
- Cross-session memory
- Performance optimization

### 2. Spawn Specialized Agents

```
/coordination-agent-spawn
```

Choose from 74+ agents:
- `coder` - Code implementation
- `tester` - Test creation
- `reviewer` - Code review
- `planner` - Project planning
- And 70 more!

### 3. Orchestrate a Task

```
/coordination-task-orchestrate "Build a REST API with authentication"
```

The swarm automatically:
1. Analyzes requirements
2. Spawns appropriate agents
3. Coordinates parallel execution
4. Monitors progress
5. Reports results

---

## 💻 Common Workflows

### Full-Stack Development

```bash
# Initialize development swarm
/swarm-development

# Spawns: backend-dev, coder, tester, reviewer
# Orchestrates: design → implement → test → review
```

### SPARC TDD Workflow

```bash
# Specification phase
/sparc-modes specification "Shopping cart system"

# Architecture design
/sparc-architect

# TDD implementation
/sparc-tdd

# Review and optimize
/sparc-reviewer
/sparc-optimizer
```

### GitHub Automation

```bash
# Analyze repository
/github-repo-analyze

# Multi-agent PR review
/github-code-review-swarm

# Automated PR management
/github-pr-manager

# Release coordination
/github-release-manager
```

---

## 🧪 Try These Commands

### Monitoring

```bash
/monitoring-status          # System overview
/monitoring-swarm-monitor   # Real-time swarm view
/monitoring-agent-metrics   # Performance metrics
```

### Analysis

```bash
/analysis-performance-report     # Performance analysis
/analysis-bottleneck-detect      # Find bottlenecks
/analysis-token-usage            # Token consumption
```

### Optimization

```bash
/optimization-auto-topology      # Auto-select topology
/optimization-parallel-execution # Parallel task execution
/optimization-cache-manage       # Cache management
```

---

## 🎨 Agent Showcase

### Core Development Agents

```
/coordination-agent-spawn coder
/coordination-agent-spawn tester
/coordination-agent-spawn reviewer
```

### GitHub Automation Agents

```
/coordination-agent-spawn pr-manager
/coordination-agent-spawn code-review-swarm
/coordination-agent-spawn release-manager
```

### Swarm Coordination Agents

```
/coordination-agent-spawn hierarchical-coordinator
/coordination-agent-spawn mesh-coordinator
/coordination-agent-spawn adaptive-coordinator
```

---

## 🔧 MCP Configuration

### Add MCP Servers

```bash
# Core MCP (required)
claude mcp add monobrain npx monobrain@alpha mcp start

# Cloud features (optional - requires auth)
```

### Test MCP Integration

In Claude Code:

```
List available MCP tools for monobrain
```

Expected: 40+ tools including:
- `swarm_init`
- `agent_spawn`
- `task_orchestrate`
- `memory_usage`
- `neural_train`
- And more!

---

## 📚 Example: Build a Todo App

### Step 1: Initialize

```
/coordination-swarm-init
```

### Step 2: Specify Requirements

```
/sparc-modes specification "Todo app with React frontend and Express backend"
```

### Step 3: Design Architecture

```
/sparc-architect
```

### Step 4: TDD Implementation

```
/sparc-tdd
```

### Step 5: Monitor Progress

```
/monitoring-swarm-monitor
```

### Step 6: Review & Optimize

```
/sparc-reviewer
/sparc-optimizer
```

### Step 7: Performance Report

```
/analysis-performance-report
```

---

## 🐛 Troubleshooting

### Commands Not Found

```bash
# Verify installation
bash scripts/verify.sh

# Check commands directory
ls ~/.claude/commands/

# Restart Claude Code
```

### MCP Not Working

```bash
# Check settings
cat ~/.claude/settings.json

# Verify MCP package
npx monobrain@alpha --version

# Reinstall if needed
npm install -g monobrain@alpha
```

### Agents Not Spawning

```bash
# Check agents directory
ls ~/.claude/agents/

# Verify permissions
chmod -R 755 ~/.claude/agents/

# Restart Claude Code
```

---

## 🎓 Next Steps

1. **Explore Commands**: Browse `~/.claude/commands/` for all 150+ commands
2. **Try Agents**: Experiment with different specialized agents
3. **Read User Guide**: `docs/USER_GUIDE.md` for detailed documentation
4. **Check Examples**: `docs/EXAMPLES.md` for real-world usage
5. **Join Community**: GitHub Discussions for help and sharing

---

## 📖 Quick Reference

### Most Used Commands

| Command | Purpose |
|---------|---------|
| `/coordination-swarm-init` | Initialize swarm |
| `/coordination-agent-spawn` | Spawn agents |
| `/coordination-task-orchestrate` | Orchestrate tasks |
| `/sparc-tdd` | TDD workflow |
| `/github-pr-manager` | PR management |
| `/monitoring-status` | System status |
| `/analysis-performance-report` | Performance |

### Most Used Agents

| Agent | Purpose |
|-------|---------|
| `coder` | Code implementation |
| `tester` | Test creation |
| `reviewer` | Code review |
| `planner` | Project planning |
| `backend-dev` | Backend development |
| `pr-manager` | PR automation |

---

## 🚀 You're Ready!

Start building with Monobrain's enterprise AI agent orchestration.

**Happy coding!** 🎉
