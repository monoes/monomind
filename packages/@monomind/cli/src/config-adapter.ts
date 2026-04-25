/**
 * Configuration Adapter
 * Converts between SystemConfig and MonobrainConfig types
 */

import type { SystemConfig } from '@monobrain/shared';
import type { MonobrainConfig } from './types.js';

/**
 * Convert SystemConfig to MonobrainConfig (CLI-specific format)
 */
export function systemConfigToMonobrainConfig(systemConfig: SystemConfig): MonobrainConfig {
  return {
    version: '3.0.0',
    projectRoot: systemConfig.orchestrator?.session?.dataDir || process.cwd(),

    // Agent configuration
    agents: {
      defaultType: 'coder',
      autoSpawn: false, // Not in SystemConfig
      maxConcurrent: systemConfig.orchestrator?.lifecycle?.maxConcurrentAgents ?? 15,
      timeout: systemConfig.orchestrator?.lifecycle?.spawnTimeout ?? 300000,
      providers: [],
    },

    // Swarm configuration
    swarm: {
      topology: normalizeTopology(systemConfig.swarm?.topology),
      maxAgents: systemConfig.swarm?.maxAgents ?? 15,
      autoScale: systemConfig.swarm?.autoScale?.enabled ?? false,
      coordinationStrategy: systemConfig.swarm?.coordination?.consensusRequired ? 'consensus' : 'leader',
      healthCheckInterval: systemConfig.swarm?.coordination?.timeoutMs ?? 10000,
    },

    // Memory configuration
    memory: {
      backend: normalizeMemoryBackend(systemConfig.memory?.type),
      persistPath: systemConfig.memory?.path || './data/memory',
      cacheSize: systemConfig.memory?.maxSize ?? 1000000,
      enableHNSW: systemConfig.memory?.agentdb?.indexType === 'hnsw',
      vectorDimension: systemConfig.memory?.agentdb?.dimensions ?? 384, // Match all-MiniLM-L6-v2 output (#1395 Bug 5)
    },

    // MCP configuration
    mcp: {
      serverHost: systemConfig.mcp?.transport?.host || 'localhost',
      serverPort: systemConfig.mcp?.transport?.port ?? 3000,
      autoStart: false, // Not in SystemConfig
      transportType: systemConfig.mcp?.transport?.type || 'stdio',
      tools: [], // Not in SystemConfig
    },

    // CLI preferences
    cli: {
      colorOutput: true,
      interactive: true,
      verbosity: 'normal',
      outputFormat: 'text',
      progressStyle: 'spinner',
    },

    // Hooks configuration
    hooks: {
      enabled: false,
      autoExecute: false,
      hooks: [],
    },
  };
}

/**
 * Convert MonobrainConfig to SystemConfig
 */
export function configToSystemConfig(config: MonobrainConfig): Partial<SystemConfig> {
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
      agentdb: {
        dimensions: config.memory.vectorDimension,
        indexType: config.memory.enableHNSW ? 'hnsw' : 'flat',
        efConstruction: 200,
        m: 16,
        quantization: 'none',
      },
    },

    mcp: {
      name: 'monobrain',
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
  };
}

/**
 * Normalize topology from SystemConfig to MonobrainConfig
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
 * Denormalize topology from MonobrainConfig to SystemConfig
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
 * Normalize memory backend from SystemConfig to MonobrainConfig
 */
function normalizeMemoryBackend(
  backend: string | undefined
): 'memory' | 'sqlite' | 'agentdb' | 'hybrid' {
  switch (backend) {
    case 'memory':
    case 'sqlite':
    case 'agentdb':
    case 'hybrid':
      return backend;
    case 'redis':
      return 'memory'; // Redis maps to memory for CLI purposes
    default:
      return 'hybrid';
  }
}

/**
 * Denormalize memory backend from MonobrainConfig to SystemConfig
 */
function denormalizeMemoryBackend(
  backend: 'memory' | 'sqlite' | 'agentdb' | 'hybrid'
): 'memory' | 'sqlite' | 'agentdb' | 'hybrid' | 'redis' {
  return backend;
}
