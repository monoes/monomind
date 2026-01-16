# hive-mind-spawn

Spawn a Hive Mind swarm with queen-led coordination.

## Usage
```bash
npx monobrain hive-mind spawn <objective> [options]
```

## Options
- `--queen-type <type>` - Queen type (strategic, tactical, adaptive)
- `--max-workers <n>` - Maximum worker agents
- `--consensus <type>` - Consensus algorithm
- `--claude` - Generate Claude Code spawn commands

## Examples
```bash
npx monobrain hive-mind spawn "Build API"
npx monobrain hive-mind spawn "Research patterns" --queen-type adaptive
npx monobrain hive-mind spawn "Build service" --claude
```
