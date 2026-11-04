import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONFIG_JSON_CANDIDATE_PATHS,
  CONFIG_YAML_CANDIDATE_PATHS,
  MEMORY_DB_CANDIDATE_PATHS,
} from '../utils/paths.js';
import { loadMetrics, saveMetrics } from './system-tools-core.js';
import { getProjectCwd, type MCPTool } from './types.js';

export const systemHealthTool: MCPTool = {
  name: 'system_health',
  description: 'Perform system health check',
  category: 'system',
  inputSchema: {
    type: 'object',
    properties: {
      deep: { type: 'boolean', description: 'Perform deep health check' },
      components: {
        type: 'array',
        items: { type: 'string' },
        description: 'Components to check',
      },
      fix: { type: 'boolean', description: 'Attempt to fix issues' },
    },
  },
  handler: async (input) => {
    const metrics = loadMetrics();
    const checks: Array<{ name: string; status: string; latency?: number; message?: string }> = [];
    const projectCwd = getProjectCwd();

    // Memory DB check — verify the store file exists at one of the real
    // locations `monomind init` creates (same paths doctor's
    // checkMemoryDatabase() checks — see utils/paths.ts).
    {
      const t0 = performance.now();
      const memoryExists = MEMORY_DB_CANDIDATE_PATHS.some((p) => existsSync(join(projectCwd, p)));
      const elapsed = performance.now() - t0;
      checks.push({
        name: 'memory',
        status: memoryExists ? 'healthy' : 'degraded',
        latency: Math.round(elapsed * 100) / 100,
        message: memoryExists ? undefined : 'Memory store not found — run memory init',
      });
    }

    // Config check — verify config file exists at one of the real
    // locations `monomind init` creates (same paths doctor's
    // checkConfigFile() checks — see utils/paths.ts).
    {
      const t0 = performance.now();
      const configExists = [...CONFIG_JSON_CANDIDATE_PATHS, ...CONFIG_YAML_CANDIDATE_PATHS].some(
        (p) => existsSync(join(projectCwd, p)),
      );
      const elapsed = performance.now() - t0;
      checks.push({
        name: 'config',
        status: configExists ? 'healthy' : 'degraded',
        latency: Math.round(elapsed * 100) / 100,
        message: configExists ? undefined : 'Config file not found — run init',
      });
    }

    // MCP check — this process is the MCP server if stdin is piped
    {
      const isStdio = !process.stdin.isTTY;
      checks.push({
        name: 'mcp',
        status: isStdio ? 'healthy' : 'unknown',
        message: isStdio ? 'MCP stdio server running (this process)' : 'Not running as MCP server',
      });
    }

    // Neural — cannot verify, report unknown
    checks.push({
      name: 'neural',
      status: 'unknown',
      message: 'Neural network health not monitored',
    });

    if (input.deep) {
      // Disk check — real free space check via os module
      {
        const t0 = performance.now();
        const elapsed = performance.now() - t0;
        // Use memory as a proxy; real disk check would need statvfs
        checks.push({
          name: 'disk',
          status: 'unknown',
          latency: Math.round(elapsed * 100) / 100,
          message: 'Disk space check not implemented — use os-level tools',
        });
      }

      // Network — cannot verify without making a request
      checks.push({
        name: 'network',
        status: 'unknown',
        message: 'Network connectivity not monitored',
      });

      // Database — check if coordination store exists
      {
        const t0 = performance.now();
        const coordPath = join(projectCwd, '.monomind', 'coordination', 'store.json');
        const dbExists = existsSync(coordPath);
        const elapsed = performance.now() - t0;
        checks.push({
          name: 'database',
          status: dbExists ? 'healthy' : 'unknown',
          latency: Math.round(elapsed * 100) / 100,
          message: dbExists ? undefined : 'Coordination store not found',
        });
      }
    }

    const healthy = checks.filter((c) => c.status === 'healthy').length;
    const total = checks.length;
    const overallHealth = healthy / total;

    // Update metrics
    metrics.health = overallHealth;
    saveMetrics(metrics);

    return {
      overall: overallHealth >= 0.8 ? 'healthy' : overallHealth >= 0.5 ? 'degraded' : 'unhealthy',
      score: Math.round(overallHealth * 100),
      checks,
      healthy,
      total,
      timestamp: new Date().toISOString(),
      issues: checks
        .filter((c) => c.status !== 'healthy')
        .map((c) => ({
          component: c.name,
          status: c.status,
          suggestion: `Check ${c.name} component configuration`,
        })),
    };
  },
};
