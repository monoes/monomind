# CLI Configuration Loading

## Overview

The CLI loads an optional JSON configuration file at startup. Config loading
never fails the CLI — a missing or invalid file falls back to defaults (with a
warning in `DEBUG=1` mode).

## Where config is loaded from

Resolution order (see `src/services/config-file-manager.ts`):

1. **`MONOMIND_CONFIG`** environment variable — explicit path
2. **`--config <path>`** flag on any command
3. **Auto-discovery**, walking up from the current directory:
   - `monomind.config.json`
   - `.monomind/config.json`

## Key files

- **`src/services/config-file-manager.ts`** — `configManager.load(cwd)`: finds,
  parses, and caches the config file
- **`src/config-adapter.ts`** — converts between the loose `SystemConfig` shape
  and the CLI's typed `MonomindConfig` (`systemConfigToMonomindConfig()` and the
  reverse)
- **`src/index.ts`** — `loadConfig()` wires the manager into the CLI context;
  failures are silent unless `DEBUG=1`

## Configuration schema (`MonomindConfig`, `src/types.ts`)

```typescript
interface MonomindConfig {
  version: string;
  projectRoot: string;

  agents: {
    defaultType: string;
    autoSpawn: boolean;
    maxConcurrent: number;
    timeout: number;
    providers: ProviderConfig[];
  };

  swarm: {
    topology: "hierarchical" | "mesh" | "ring" | "star" | "hybrid";
    maxAgents: number;
    autoScale: boolean;
    coordinationStrategy: "consensus" | "leader" | "distributed";
    healthCheckInterval: number;
  };

  memory: {
    backend: "lancedb" | "sqlite" | "memory" | "hybrid";
    persistPath: string;
    cacheSize: number;
    enableHNSW: boolean;
    vectorDimension: number;
  };

  mcp: {
    serverHost: string;
    serverPort: number;
    autoStart: boolean;
    transportType: "stdio" | "http" | "websocket";
    tools: string[];
  };

  cli: {
    colorOutput: boolean;
    interactive: boolean;
    verbosity: "quiet" | "normal" | "verbose" | "debug";
    outputFormat: "text" | "json" | "table";
    progressStyle: "bar" | "spinner" | "dots" | "none";
  };

  hooks: {
    enabled: boolean;
    autoExecute: boolean;
    hooks: HookDefinition[];
  };
}
```

## Usage examples

```bash
# Use default config search paths
monomind agent spawn -t coder

# Use a specific config file
monomind agent spawn -t coder --config ./custom-config.json

# Point at a config via env var
MONOMIND_CONFIG=./configs/ci.json monomind swarm init
```

## Error handling

1. **File not found** — falls back to default configuration
2. **Invalid JSON** — logs a warning (under `DEBUG=1`) and uses defaults
3. **Missing fields** — merged with default values

## Architecture decisions

1. **Adapter pattern** — `config-adapter.ts` separates the on-disk shape from
   the CLI's typed `MonomindConfig`
2. **Optional loading** — config files are optional; failures never crash the CLI
3. **Merge strategy** — loaded config is merged over defaults
