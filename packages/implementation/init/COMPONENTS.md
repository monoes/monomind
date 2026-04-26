# Components Reference

Detailed documentation for each component created by the V1 init system.

## Directory Structure

```
project/
├── .claude/                    # Claude Code integration
│   ├── settings.json           # Hooks and permissions
│   ├── skills/                 # Claude Code skills
│   ├── commands/               # Claude Code commands
│   ├── agents/                 # Agent definitions
│   ├── helpers/                # Utility scripts
│   ├── statusline.sh           # Unix/macOS statusline
│   └── statusline.mjs          # ESM statusline module
├── .monomind/               # V1 runtime
│   ├── config.yaml             # Runtime configuration
│   ├── data/                   # Persistent data
│   ├── logs/                   # Log files
│   ├── sessions/               # Session archives
│   ├── hooks/                  # Custom hooks
│   ├── agents/                 # Agent state
│   ├── workflows/              # Workflow definitions
│   └── pids/                   # Process ID files
└── .mcp.json                   # MCP server configuration
```

## Skills

Skills are installed to `.claude/skills/` and provide specialized capabilities.

### Core Skills
| Skill | Description |
|-------|-------------|
| swarm-orchestration | Multi-agent swarm coordination |
| swarm-advanced | Advanced swarm patterns |
| sparc-methodology | SPARC development methodology |
| hooks-automation | Hook automation and learning |
| pair-programming | AI-assisted pair programming |
| verification-quality | Code quality verification |
| stream-chain | Data stream processing |
| skill-builder | Custom skill creation |

### AgentDB Skills
| Skill | Description |
|-------|-------------|
| agentdb-advanced | Advanced AgentDB features |
| agentdb-learning | AI learning with AgentDB |
| agentdb-memory-patterns | Memory pattern implementation |
| agentdb-optimization | AgentDB performance optimization |
| agentdb-vector-search | Semantic vector search |
| reasoningbank-agentdb | ReasoningBank integration |
| reasoningbank-intelligence | Adaptive learning patterns |

### GitHub Skills
| Skill | Description |
|-------|-------------|
| github-code-review | AI-powered code review |
| github-multi-repo | Multi-repository management |
| github-project-management | Project board automation |
| github-release-management | Release orchestration |
| github-workflow-automation | GitHub Actions automation |

### Skills
| Skill | Description |
|-------|-------------|
| v1-cli-modernization | CLI enhancement |
| v1-core-implementation | Core module implementation |
| v1-ddd-architecture | Domain-driven design |
| v1-integration-deep | agentic-flow integration |
| v1-mcp-optimization | MCP server optimization |
| v1-memory-unification | Memory system unification |
| v1-performance-optimization | Performance targets |
| v1-security-overhaul | Security improvements |
| v1-swarm-coordination | Swarm coordination |

## Commands

Commands are installed to `.claude/commands/` and provide quick actions.

### Core Commands
- `monomind-help.md` - Help documentation
- `monomind-swarm.md` - Swarm operations
- `monomind-memory.md` - Memory operations

### Command Groups
| Group | Contents |
|-------|----------|
| analysis/ | Code analysis commands |
| automation/ | Task automation |
| github/ | GitHub operations |
| hooks/ | Hook management |
| monitoring/ | System monitoring |
| optimization/ | Performance tuning |
| sparc/ | SPARC methodology |

## Agents

Agent definitions are installed to `.claude/agents/`.

### Core Agents
- coder - Code generation and implementation
- tester - Testing and quality assurance
- reviewer - Code review and security
- researcher - Information gathering
- architect - System design

### Agent Categories
| Category | Agents |
|----------|--------|
| core/ | Basic development agents |
| github/ | GitHub-integrated agents |
| sparc/ | SPARC methodology agents |
| swarm/ | Swarm coordination agents |
| consensus/ | Distributed consensus agents |
| hive-mind/ | Collective intelligence agents |

## Helpers

Helper scripts are installed to `.claude/helpers/`.

### Cross-Platform Scripts (Node.js)
| Script | Description |
|--------|-------------|
| session.js | Session lifecycle management |
| router.js | Intelligent task routing |
| memory.js | Key-value memory store |
| statusline.js | Progress display |

### Unix/macOS Scripts
| Script | Description |
|--------|-------------|
| daemon-manager.sh | Background process management |
| swarm-monitor.sh | Real-time swarm monitoring |
| checkpoint-manager.sh | Session checkpointing |
| pre-commit | Git pre-commit hook |
| post-commit | Git post-commit hook |

### Windows Scripts
| Script | Description |
|--------|-------------|
| daemon-manager.ps1 | PowerShell daemon manager |
| daemon-manager.cmd | Batch wrapper for PowerShell |

## Statusline

The statusline provides real-time V1 progress in the shell.

### statusline.sh (Unix/macOS)
Advanced bash script showing:
- DDD domain progress
- Swarm agent count
- Security CVE status
- Performance metrics
- Context window usage
- Model and branch info

### statusline.mjs (ESM Module)
Claude Code statusline module showing:
- Model name
- Token usage
- Cost tracking
- Swarm status
- Session time

## MCP Configuration

`.mcp.json` configures MCP server integration.

```json
{
  "mcpServers": {
    "monomind": {
      "command": "npx",
      "args": ["@monomind/cli", "mcp", "start"],
      "env": {
        "MONOMIND_MODE": "v1",
        "MONOMIND_HOOKS_ENABLED": "true",
        "MONOMIND_TOPOLOGY": "hierarchical-mesh",
        "MONOMIND_MAX_AGENTS": "15",
        "MONOMIND_MEMORY_BACKEND": "hybrid"
      }
    }
  }
}
```

## Runtime Configuration

`.monomind/config.yaml` configures V1 runtime.

```yaml
version: "3.0.0"

swarm:
  topology: hierarchical-mesh
  maxAgents: 15
  autoScale: true
  coordinationStrategy: consensus

memory:
  backend: hybrid
  enableHNSW: true
  persistPath: .monomind/data
  cacheSize: 100

neural:
  enabled: true
  modelPath: .monomind/neural

hooks:
  enabled: true
  autoExecute: true

mcp:
  autoStart: false
  port: 3000
```

## Platform-Specific Files

The init system auto-detects the platform and generates appropriate files:

### Windows
- `daemon-manager.ps1` - PowerShell daemon management
- `daemon-manager.cmd` - Batch wrapper
- Platform paths use backslashes
- Config stored in `%APPDATA%`

### macOS
- `daemon-manager.sh` - Bash daemon management
- Zsh-compatible statusline hooks
- Config stored in `~/Library/Application Support`

### Linux
- `daemon-manager.sh` - Bash daemon management
- XDG-compliant config paths
- Config stored in `~/.config`
