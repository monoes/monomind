/**
 * Config Adapter Deep Edge-Case Tests
 *
 * Covers branches not exercised by the existing config-adapter.test.ts:
 *   - normalizeTopology: 'adaptive' -> 'hybrid', unknown -> 'hierarchical'
 *   - normalizeMemoryBackend: 'redis' -> 'memory', unknown -> 'hybrid'
 *   - denormalizeTopology: 'hybrid' -> 'hierarchical-mesh', passthrough for others
 *   - Missing/undefined nested fields in SystemConfig
 *   - configToSystemConfig with different coordination + HNSW combos
 */

import { describe, it, expect } from 'vitest';
import { systemConfigToMonobrainConfig, configToSystemConfig } from '../src/config-adapter.js';
import type { SystemConfig } from '@monobrain/shared';
import type { MonobrainConfig } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helper: minimal valid SystemConfig
// ---------------------------------------------------------------------------
function minimalSystemConfig(overrides: Record<string, unknown> = {}): SystemConfig {
  return {
    orchestrator: {
      lifecycle: {
        autoStart: false,
        maxConcurrentAgents: 5,
        shutdownTimeoutMs: 30000,
        cleanupOrphanedAgents: true,
      },
      session: {
        dataDir: '/data',
        persistState: true,
        stateFile: 'session.json',
      },
      monitoring: {
        enabled: true,
        metricsIntervalMs: 5000,
        healthCheckIntervalMs: 10000,
      },
    },
    swarm: { topology: 'hierarchical', maxAgents: 10 },
    memory: { type: 'hybrid' },
    mcp: {
      enabled: false,
      transport: { type: 'stdio', host: 'localhost', port: 3000 },
      enabledTools: [],
      security: {
        requireAuth: false,
        allowedOrigins: ['*'],
        rateLimiting: { enabled: true, maxRequestsPerMinute: 100 },
      },
    },
    logging: { level: 'info', pretty: true, destination: 'console', format: 'text' },
    hooks: { enabled: false, autoExecute: false, definitions: [] },
    ...overrides,
  } as SystemConfig;
}

// ---------------------------------------------------------------------------
// Helper: minimal valid MonobrainConfig
// ---------------------------------------------------------------------------
function minimalMonobrainConfig(overrides: Partial<MonobrainConfig> = {}): MonobrainConfig {
  return {
    version: '3.0.0',
    projectRoot: '/test',
    agents: {
      defaultType: 'coder',
      autoSpawn: false,
      maxConcurrent: 10,
      timeout: 30000,
      providers: [],
    },
    swarm: {
      topology: 'hierarchical',
      maxAgents: 10,
      autoScale: false,
      coordinationStrategy: 'leader',
      healthCheckInterval: 5000,
    },
    memory: {
      backend: 'hybrid',
      persistPath: '/data',
      cacheSize: 100000,
      enableHNSW: false,
      vectorDimension: 1536,
    },
    mcp: {
      serverHost: 'localhost',
      serverPort: 3000,
      autoStart: false,
      transportType: 'stdio',
      tools: [],
    },
    cli: {
      colorOutput: true,
      interactive: true,
      verbosity: 'normal',
      outputFormat: 'text',
      progressStyle: 'spinner',
    },
    hooks: { enabled: false, autoExecute: false, hooks: [] },
    ...overrides,
  };
}

// ===========================================================================
// systemConfigToMonobrainConfig edge cases
// ===========================================================================
describe('ConfigAdapter deep edge cases', () => {
  describe('normalizeTopology', () => {
    it('should map "adaptive" to "hybrid"', () => {
      const cfg = minimalSystemConfig({ swarm: { topology: 'adaptive', maxAgents: 8 } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.topology).toBe('hybrid');
    });

    it('should default unknown topology to "hierarchical"', () => {
      const cfg = minimalSystemConfig({ swarm: { topology: 'banana', maxAgents: 4 } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.topology).toBe('hierarchical');
    });

    it('should pass through every recognized topology', () => {
      const topologies = ['hierarchical', 'mesh', 'ring', 'star', 'hybrid', 'hierarchical-mesh'] as const;
      for (const t of topologies) {
        const cfg = minimalSystemConfig({ swarm: { topology: t, maxAgents: 5 } });
        const v1 = systemConfigToMonobrainConfig(cfg);
        expect(v1.swarm.topology).toBe(t);
      }
    });

    it('should default to "hierarchical" when topology is undefined', () => {
      const cfg = minimalSystemConfig({ swarm: { maxAgents: 5 } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.topology).toBe('hierarchical');
    });
  });

  describe('normalizeMemoryBackend', () => {
    it('should map "redis" to "memory"', () => {
      const cfg = minimalSystemConfig({ memory: { type: 'redis' } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.backend).toBe('memory');
    });

    it('should default unknown backend to "hybrid"', () => {
      const cfg = minimalSystemConfig({ memory: { type: 'unknown-db' } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.backend).toBe('hybrid');
    });

    it('should default undefined backend to "hybrid"', () => {
      const cfg = minimalSystemConfig({ memory: {} });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.backend).toBe('hybrid');
    });

    it('should pass through every recognized backend', () => {
      const backends = ['memory', 'sqlite', 'agentdb', 'hybrid'] as const;
      for (const b of backends) {
        const cfg = minimalSystemConfig({ memory: { type: b } });
        const v1 = systemConfigToMonobrainConfig(cfg);
        expect(v1.memory.backend).toBe(b);
      }
    });
  });

  describe('missing optional fields in SystemConfig', () => {
    it('should use default projectRoot from process.cwd when dataDir missing', () => {
      const cfg = minimalSystemConfig();
      // Overwrite session to not have dataDir
      (cfg.orchestrator as any).session = {
        persistState: true,
        stateFile: 'session.json',
      };
      const v1 = systemConfigToMonobrainConfig(cfg);
      // When dataDir is undefined, falls back to process.cwd()
      expect(typeof v1.projectRoot).toBe('string');
      expect(v1.projectRoot.length).toBeGreaterThan(0);
    });

    it('should use default memory path when path is missing', () => {
      const cfg = minimalSystemConfig({ memory: { type: 'sqlite' } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.persistPath).toBe('./data/memory');
    });

    it('should use default MCP host when transport host is missing', () => {
      const cfg = minimalSystemConfig();
      (cfg.mcp as any).transport = { type: 'stdio', port: 3000 };
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.mcp.serverHost).toBe('localhost');
    });

    it('should use default maxAgents of 15 when swarm.maxAgents is missing', () => {
      const cfg = minimalSystemConfig({ swarm: { topology: 'mesh' } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.maxAgents).toBe(15);
    });

    it('should use default cacheSize when memory.maxSize is missing', () => {
      const cfg = minimalSystemConfig({ memory: { type: 'hybrid' } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.cacheSize).toBe(1000000);
    });

    it('should set enableHNSW false when agentdb indexType is not hnsw', () => {
      const cfg = minimalSystemConfig({
        memory: {
          type: 'agentdb',
          agentdb: { indexType: 'flat', dimensions: 768 },
        },
      });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.enableHNSW).toBe(false);
    });

    it('should set enableHNSW true when agentdb indexType is hnsw', () => {
      const cfg = minimalSystemConfig({
        memory: {
          type: 'agentdb',
          agentdb: { indexType: 'hnsw', dimensions: 768 },
        },
      });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.memory.enableHNSW).toBe(true);
    });
  });

  describe('swarm coordination mapping in systemConfigToMonobrainConfig', () => {
    it('should set coordinationStrategy to "consensus" when consensusRequired is true', () => {
      const cfg = minimalSystemConfig({
        swarm: {
          topology: 'mesh',
          maxAgents: 10,
          coordination: { consensusRequired: true, timeoutMs: 5000 },
        },
      });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.coordinationStrategy).toBe('consensus');
    });

    it('should set coordinationStrategy to "leader" when consensusRequired is false', () => {
      const cfg = minimalSystemConfig({
        swarm: {
          topology: 'mesh',
          maxAgents: 10,
          coordination: { consensusRequired: false, timeoutMs: 5000 },
        },
      });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.coordinationStrategy).toBe('leader');
    });

    it('should default autoScale to false when swarm.autoScale is missing', () => {
      const cfg = minimalSystemConfig({ swarm: { topology: 'mesh', maxAgents: 5 } });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.autoScale).toBe(false);
    });

    it('should pick up autoScale enabled from SystemConfig', () => {
      const cfg = minimalSystemConfig({
        swarm: {
          topology: 'mesh',
          maxAgents: 10,
          autoScale: { enabled: true },
        },
      });
      const v1 = systemConfigToMonobrainConfig(cfg);
      expect(v1.swarm.autoScale).toBe(true);
    });
  });

  // ===========================================================================
  // configToSystemConfig edge cases
  // ===========================================================================
  describe('denormalizeTopology in configToSystemConfig', () => {
    it('should map "hybrid" back to "hierarchical-mesh"', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, topology: 'hybrid' },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.topology).toBe('hierarchical-mesh');
    });

    it('should pass through non-hybrid topologies unchanged', () => {
      const topologies = ['hierarchical', 'mesh', 'ring', 'star', 'hierarchical-mesh'] as const;
      for (const t of topologies) {
        const v1 = minimalMonobrainConfig({
          swarm: { ...minimalMonobrainConfig().swarm, topology: t },
        });
        const sys = configToSystemConfig(v1);
        expect(sys.swarm?.topology).toBe(t);
      }
    });
  });

  describe('consensus mapping in configToSystemConfig', () => {
    it('should set consensusRequired to true for "consensus" strategy', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, coordinationStrategy: 'consensus' },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.coordination?.consensusRequired).toBe(true);
    });

    it('should set consensusRequired to false for non-consensus strategy', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, coordinationStrategy: 'leader' },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.coordination?.consensusRequired).toBe(false);
    });
  });

  describe('HNSW toggle in configToSystemConfig', () => {
    it('should set indexType "hnsw" when enableHNSW is true', () => {
      const v1 = minimalMonobrainConfig({
        memory: { ...minimalMonobrainConfig().memory, enableHNSW: true },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.memory?.agentdb?.indexType).toBe('hnsw');
    });

    it('should set indexType "flat" when enableHNSW is false', () => {
      const v1 = minimalMonobrainConfig({
        memory: { ...minimalMonobrainConfig().memory, enableHNSW: false },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.memory?.agentdb?.indexType).toBe('flat');
    });
  });

  describe('autoScale mapping in configToSystemConfig', () => {
    it('should set autoScale.enabled true when v1 autoScale is true', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, autoScale: true },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.autoScale?.enabled).toBe(true);
    });

    it('should set autoScale.enabled false when v1 autoScale is false', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, autoScale: false },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.autoScale?.enabled).toBe(false);
    });

    it('should carry maxAgents into autoScale.maxAgents', () => {
      const v1 = minimalMonobrainConfig({
        swarm: { ...minimalMonobrainConfig().swarm, maxAgents: 25, autoScale: true },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.autoScale?.maxAgents).toBe(25);
    });
  });

  describe('MCP transport mapping in configToSystemConfig', () => {
    it('should map transportType "http" correctly', () => {
      const v1 = minimalMonobrainConfig({
        mcp: { ...minimalMonobrainConfig().mcp, transportType: 'http', serverPort: 8080 },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.mcp?.transport?.type).toBe('http');
      expect(sys.mcp?.transport?.port).toBe(8080);
    });

    it('should map transportType "websocket" correctly', () => {
      const v1 = minimalMonobrainConfig({
        mcp: { ...minimalMonobrainConfig().mcp, transportType: 'websocket', serverHost: '0.0.0.0' },
      });
      const sys = configToSystemConfig(v1);
      expect(sys.mcp?.transport?.type).toBe('websocket');
      expect(sys.mcp?.transport?.host).toBe('0.0.0.0');
    });
  });

  describe('round-trip preserves diverse configurations', () => {
    it('should round-trip with agentdb + hnsw enabled', () => {
      const original = minimalSystemConfig({
        memory: {
          type: 'agentdb',
          path: '/my/data',
          maxSize: 500000,
          agentdb: { dimensions: 768, indexType: 'hnsw' },
        },
      });
      const v1 = systemConfigToMonobrainConfig(original);
      expect(v1.memory.backend).toBe('agentdb');
      expect(v1.memory.enableHNSW).toBe(true);
      expect(v1.memory.vectorDimension).toBe(768);

      const sys = configToSystemConfig(v1);
      expect(sys.memory?.type).toBe('agentdb');
      expect(sys.memory?.agentdb?.indexType).toBe('hnsw');
      expect(sys.memory?.agentdb?.dimensions).toBe(768);
    });

    it('should round-trip with consensus coordination', () => {
      const original = minimalSystemConfig({
        swarm: {
          topology: 'hierarchical-mesh',
          maxAgents: 12,
          coordination: { consensusRequired: true, timeoutMs: 8000 },
        },
      });
      const v1 = systemConfigToMonobrainConfig(original);
      expect(v1.swarm.coordinationStrategy).toBe('consensus');

      const sys = configToSystemConfig(v1);
      expect(sys.swarm?.coordination?.consensusRequired).toBe(true);
    });
  });
});
