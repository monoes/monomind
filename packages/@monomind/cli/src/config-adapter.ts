/**
 * Configuration Adapter
 * Converts between SystemConfig and MonomindConfig types
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SystemConfig = any;
import type { MonomindConfig } from './types.js';
// Share fallback values with config-file-manager.ts's own DEFAULT_CONFIG so
// a config that round-trips through this adapter doesn't silently diverge
// from what `monomind config create`/`reset` would produce (e.g. maxAgents
// 8 vs a separately-hardcoded 15, hooks.enabled true vs false).
import { DEFAULT_CONFIG } from './services/config-file-manager.js';

// structuredClone so nested arrays/objects (e.g. hooks.hooks) returned by
// systemConfigToMonomindConfig() below are never the live DEFAULT_CONFIG
// reference — matches config-file-manager.ts's own cloneDefaultConfig() fix,
// which this file's direct DEFAULT_CONFIG import would otherwise bypass.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AGENTS_DEFAULTS = structuredClone(DEFAULT_CONFIG.agents) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SWARM_DEFAULTS = structuredClone(DEFAULT_CONFIG.swarm) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CLI_DEFAULTS = structuredClone(DEFAULT_CONFIG.cli) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const HOOKS_DEFAULTS = structuredClone(DEFAULT_CONFIG.hooks) as any;

/**
 * Convert SystemConfig to MonomindConfig (CLI-specific format)
 */
export function systemConfigToMonomindConfig(systemConfig: SystemConfig): MonomindConfig {
  return {
    version: '3.0.0',
    projectRoot: systemConfig.orchestrator?.session?.dataDir || process.cwd(),

    // Agent configuration
    agents: {
      defaultType: systemConfig.agents?.defaultType ?? AGENTS_DEFAULTS.defaultType,
      autoSpawn: systemConfig.agents?.autoSpawn ?? AGENTS_DEFAULTS.autoSpawn,
      maxConcurrent: systemConfig.orchestrator?.lifecycle?.maxConcurrentAgents ?? AGENTS_DEFAULTS.maxConcurrent,
      timeout: systemConfig.orchestrator?.lifecycle?.spawnTimeout ?? AGENTS_DEFAULTS.timeout,
      providers: [],
    },

    // Swarm configuration
    swarm: {
      topology: normalizeTopology(systemConfig.swarm?.topology),
      maxAgents: systemConfig.swarm?.maxAgents ?? SWARM_DEFAULTS.maxAgents,
      autoScale: systemConfig.swarm?.autoScale?.enabled ?? SWARM_DEFAULTS.autoScale,
      coordinationStrategy: systemConfig.swarm?.coordination?.consensusRequired ? 'consensus' : 'leader',
      healthCheckInterval: systemConfig.swarm?.coordination?.timeoutMs ?? SWARM_DEFAULTS.healthCheckInterval,
    },

    // Memory configuration
    memory: {
      backend: normalizeMemoryBackend(systemConfig.memory?.type),
      persistPath: systemConfig.memory?.path || './data/memory',
      cacheSize: systemConfig.memory?.maxSize ?? 1000000,
      enableHNSW: systemConfig.memory?.lancedb?.indexType === 'hnsw',
      vectorDimension: systemConfig.memory?.lancedb?.dimensions ?? 384,
    },

    // MCP configuration
    mcp: {
      serverHost: systemConfig.mcp?.transport?.host || 'localhost',
      serverPort: systemConfig.mcp?.transport?.port ?? 3000,
      autoStart: false, // Not in SystemConfig
      transportType: systemConfig.mcp?.transport?.type || 'stdio',
      tools: [], // Not in SystemConfig
    },

    // CLI preferences — read from SystemConfig.cli when present, falling
    // back to the shared DEFAULT_CONFIG.cli values (not separately
    // hardcoded numbers that could silently drop user-configured values).
    cli: {
      colorOutput: systemConfig.cli?.colorOutput ?? CLI_DEFAULTS.colorOutput,
      interactive: systemConfig.cli?.interactive ?? CLI_DEFAULTS.interactive,
      verbosity: systemConfig.cli?.verbosity ?? CLI_DEFAULTS.verbosity,
      outputFormat: systemConfig.cli?.outputFormat ?? CLI_DEFAULTS.outputFormat,
      progressStyle: systemConfig.cli?.progressStyle ?? CLI_DEFAULTS.progressStyle,
    },

    // Hooks configuration — likewise read from SystemConfig.hooks when
    // present, falling back to the shared DEFAULT_CONFIG.hooks values.
    hooks: {
      enabled: systemConfig.hooks?.enabled ?? HOOKS_DEFAULTS.enabled,
      autoExecute: systemConfig.hooks?.autoExecute ?? HOOKS_DEFAULTS.autoExecute,
      hooks: systemConfig.hooks?.hooks ?? HOOKS_DEFAULTS.hooks,
    },

    // Neural pattern-learning configuration
    neural: {
      enabled: systemConfig.neural?.enabled ?? true,
      disableNative: systemConfig.neural?.disableNative ?? false,
    },
  };
}

/**
 * Convert MonomindConfig to SystemConfig
 */
export function configToSystemConfig(config: MonomindConfig): Partial<SystemConfig> {
  return {
    orchestrator: {
      lifecycle: {
        maxConcurrentAgents: config.agents.maxConcurrent,
        spawnTimeout: config.agents.timeout,
        terminateTimeout: 10000,
        maxSpawnRetries: 3,
      },
      session: {
        dataDir: config.projectRoot,
        persistSessions: true,
        sessionRetentionMs: 3600000,
      },
      health: {
        checkInterval: config.swarm.healthCheckInterval,
        historyLimit: 100,
        degradedThreshold: 1,
        unhealthyThreshold: 2,
      },
    },

    swarm: {
      topology: denormalizeTopology(config.swarm.topology),
      maxAgents: config.swarm.maxAgents,
      autoScale: {
        enabled: config.swarm.autoScale,
        minAgents: 1,
        maxAgents: config.swarm.maxAgents,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3,
      },
      coordination: {
        consensusRequired: config.swarm.coordinationStrategy === 'consensus',
        timeoutMs: config.swarm.healthCheckInterval,
        retryPolicy: {
          maxRetries: 3,
          backoffMs: 500,
        },
      },
      communication: {
        protocol: 'events',
        batchSize: 10,
        flushIntervalMs: 100,
      },
    },

    memory: {
      type: denormalizeMemoryBackend(config.memory.backend),
      path: config.memory.persistPath,
      maxSize: config.memory.cacheSize,
      lancedb: {
        dimensions: config.memory.vectorDimension,
        indexType: config.memory.enableHNSW ? 'hnsw' : 'flat',
        nProbes: 20,
      },
    },

    mcp: {
      name: 'monomind',
      version: '3.0.0',
      transport: {
        type: config.mcp.transportType as 'stdio' | 'http' | 'websocket',
        host: config.mcp.serverHost,
        port: config.mcp.serverPort,
      },
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
        logging: true,
      },
    },

    // Neural pattern-learning configuration — only emit when present
    ...(config.neural
      ? {
          neural: {
            enabled: config.neural.enabled ?? true,
            disableNative: config.neural.disableNative ?? false,
          },
        }
      : {}),
  };
}

/**
 * Normalize topology from SystemConfig to MonomindConfig
 */
function normalizeTopology(
  topology: string | undefined
): 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh' {
  switch (topology) {
    case 'hierarchical':
    case 'mesh':
    case 'ring':
    case 'star':
    case 'hybrid':
    case 'hierarchical-mesh':
      return topology;
    case 'adaptive':
      return 'hybrid';
    default:
      return 'hierarchical';
  }
}

/**
 * Denormalize topology from MonomindConfig to SystemConfig
 */
function denormalizeTopology(
  topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh'
): 'hierarchical' | 'mesh' | 'ring' | 'star' | 'adaptive' | 'hierarchical-mesh' {
  if (topology === 'hybrid') {
    return 'hierarchical-mesh';
  }
  return topology;
}

/**
 * Normalize memory backend from SystemConfig to MonomindConfig
 */
function normalizeMemoryBackend(
  backend: string | undefined
): 'memory' | 'sqlite' | 'lancedb' | 'hybrid' {
  switch (backend) {
    case 'memory':
    case 'sqlite':
    case 'lancedb':
    case 'hybrid':
      return backend;
    case 'agentdb':
      return 'lancedb'; // legacy alias
    case 'redis':
      return 'memory';
    default:
      return 'hybrid';
  }
}

/**
 * Denormalize memory backend from MonomindConfig to SystemConfig
 */
function denormalizeMemoryBackend(
  backend: 'memory' | 'sqlite' | 'lancedb' | 'hybrid'
): 'memory' | 'sqlite' | 'lancedb' | 'hybrid' | 'redis' {
  return backend;
}
