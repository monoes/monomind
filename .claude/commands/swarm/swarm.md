# swarm

Main swarm orchestration command for Monomind.

## Usage
```bash
npx monomind swarm <objective> [options]
```

## Options
- `--strategy <type>` - Execution strategy (research, development, analysis, testing)
- `--mode <type>` - Coordination mode (centralized, distributed, hierarchical, mesh)
- `--max-agents <n>` - Maximum number of agents (default: 5)
- `--claude` - Open Claude Code CLI with swarm prompt
- `--parallel` - Enable parallel execution

## Examples
```bash
# Basic swarm
npx monomind swarm "Build REST API"

# With strategy
npx monomind swarm "Research AI patterns" --strategy research

# Open in Claude Code
npx monomind swarm "Build API" --claude
```
