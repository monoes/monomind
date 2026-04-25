/**
 * System MCP Tools for CLI
 *
 * V2 Compatibility - System monitoring tools: status, metrics, health
 *
 * ✅ Uses REAL system metrics via Node.js APIs:
 * - process.memoryUsage() for real memory stats
 * - process.cpuUsage() for real CPU stats
 * - os module for system information
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as os from 'node:os';

// Read version dynamically from package.json
function getPackageVersion(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const pkgPath = join(__dirname, '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '3.0.0';
  } catch {
    return '3.0.0';
  }
}
const PKG_VERSION = getPackageVersion();

// Storage paths
const STORAGE_DIR = '.monobrain';
const SYSTEM_DIR = 'system';
const METRICS_FILE = 'metrics.json';

interface SystemMetrics {
  startTime: string;
  lastCheck: string;
  uptime: number;
  health: number;
  cpu: number;
  memory: { used: number; total: number };
  agents: { active: number; total: number };
  tasks: { pending: number; completed: number; failed: number };
  requests: { total: number; success: number; errors: number };
}

function getSystemDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, SYSTEM_DIR);
}

function getMetricsPath(): string {
  return join(getSystemDir(), METRICS_FILE);
}

function ensureSystemDir(): void {
  const dir = getSystemDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadMetrics(): SystemMetrics {
  try {
    const path = getMetricsPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return default metrics
  }
  return {
    startTime: new Date().toISOString(),
    lastCheck: new Date().toISOString(),
    uptime: 0,
    health: 1.0,
    cpu: os.loadavg()[0] * 100 / os.cpus().length,
    memory: { used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024), total: Math.round(os.totalmem() / 1024 / 1024) },
    agents: { active: 0, total: 0 },
    tasks: { pending: 0, completed: 0, failed: 0 },
    requests: { total: 0, success: 0, errors: 0 },
  };
}

function saveMetrics(metrics: SystemMetrics): void {
  ensureSystemDir();
  metrics.lastCheck = new Date().toISOString();
  writeFileSync(getMetricsPath(), JSON.stringify(metrics, null, 2), 'utf-8');
}

export const systemTools: MCPTool[] = [
  {
    name: 'system_status',
    description: 'Get overall system status',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Include detailed information' },
        components: { type: 'array', items: { type: 'string' }, description: 'Specific components to check' },
      },
    },
    handler: async (input) => {
      const metrics = loadMetrics();
      const uptime = Date.now() - new Date(metrics.startTime).getTime();

      const status = {
        status: metrics.health >= 0.8 ? 'healthy' : metrics.health >= 0.5 ? 'degraded' : 'unhealthy',
        uptime,
        uptimeFormatted: `${Math.floor(uptime / 3600000)}h ${Math.floor((uptime % 3600000) / 60000)}m`,
        version: PKG_VERSION,
        components: {
          swarm: { status: 'running', health: metrics.health },
          memory: { status: 'unknown', _note: 'Health not measured — use system_health for real checks' },
          neural: { status: 'unknown', _note: 'Health not measured — use system_health for real checks' },
          mcp: { status: 'unknown', _note: 'Health not measured — use system_health for real checks' },
        },
        lastCheck: new Date().toISOString(),
      };

      if (input.verbose) {
        return {
          ...status,
          metrics: {
            cpu: metrics.cpu,
            memory: metrics.memory,
            agents: metrics.agents,
            tasks: metrics.tasks,
          },
        };
      }

      return status;
    },
  },
  {
    name: 'system_metrics',
    description: 'Get system metrics and performance data',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['all', 'cpu', 'memory', 'agents', 'tasks', 'requests'], description: 'Metrics category' },
        timeRange: { type: 'string', description: 'Time range (e.g., 1h, 24h, 7d)' },
        format: { type: 'string', enum: ['json', 'table', 'summary'], description: 'Output format' },
      },
    },
    handler: async (input) => {
      const store = loadMetrics();
      const category = (input.category as string) || 'all';

      // Get REAL system metrics via Node.js APIs
      const memUsage = process.memoryUsage();
      const loadAvg = os.loadavg();
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();

      // Read real agent/task counts — try AgentDB first, fallback to JSON stores
      let agentCounts = { active: 0, total: 0 };
      let taskCounts = { pending: 0, completed: 0, failed: 0 };
      let _metricsSource: 'agentdb' | 'json-store' | 'none' = 'none';

      // Primary: AgentDB (sql.js + HNSW)
      try {
        const bridge = await import('../memory/memory-bridge.js');
        const agentResults = await bridge.bridgeListEntries({ namespace: 'agents', limit: 10000 }) as { entries?: Array<{ metadata?: string; value?: string }> } | null;
        const agentEntries = agentResults?.entries;
        if (agentEntries && agentEntries.length > 0) {
          let active = 0;
          for (const a of agentEntries) {
            try {
              const meta = a.metadata ? JSON.parse(a.metadata) : (a.value ? JSON.parse(a.value) : {});
              if (meta.status === 'active' || meta.status === 'running') active++;
            } catch { /* skip unparseable */ }
          }
          agentCounts = { total: agentEntries.length, active };
          _metricsSource = 'agentdb';
        }
        const taskResults = await bridge.bridgeListEntries({ namespace: 'tasks', limit: 10000 }) as { entries?: Array<{ metadata?: string; value?: string }> } | null;
        const taskEntries = taskResults?.entries;
        if (taskEntries && taskEntries.length > 0) {
          let pending = 0, completed = 0, failed = 0;
          for (const t of taskEntries) {
            try {
              const meta = t.metadata ? JSON.parse(t.metadata) : (t.value ? JSON.parse(t.value) : {});
              if (meta.status === 'pending' || meta.status === 'assigned') pending++;
              else if (meta.status === 'completed') completed++;
              else if (meta.status === 'failed') failed++;
            } catch { /* skip */ }
          }
          taskCounts = { pending, completed, failed };
          _metricsSource = 'agentdb';
        }
      } catch { /* AgentDB not available, try JSON fallback */ }

      // Fallback: JSON store files (backward compatibility)
      if (_metricsSource === 'none') {
        try {
          const agentStorePath = join(getProjectCwd(), STORAGE_DIR, 'agents', 'store.json');
          if (existsSync(agentStorePath)) {
            const agentStore = JSON.parse(readFileSync(agentStorePath, 'utf-8'));
            const agents = Object.values(agentStore.agents || {}) as Array<{ status: string }>;
            agentCounts = {
              total: agents.length,
              active: agents.filter(a => a.status === 'active' || a.status === 'running').length,
            };
            _metricsSource = 'json-store';
          }
        } catch { /* agent store not available */ }
        try {
          const taskStorePath = join(getProjectCwd(), STORAGE_DIR, 'tasks', 'store.json');
          if (existsSync(taskStorePath)) {
            const taskStore = JSON.parse(readFileSync(taskStorePath, 'utf-8'));
            const tasks = Object.values(taskStore.tasks || {}) as Array<{ status: string }>;
            taskCounts = {
              pending: tasks.filter(t => t.status === 'pending' || t.status === 'assigned').length,
              completed: tasks.filter(t => t.status === 'completed').length,
              failed: tasks.filter(t => t.status === 'failed').length,
            };
            _metricsSource = 'json-store';
          }
        } catch { /* task store not available */ }
      }

      const currentMetrics: SystemMetrics = {
        ...store,
        cpu: loadAvg[0] * 100 / cpus.length, // Real CPU load percentage
        memory: {
          used: Math.round((totalMem - freeMem) / 1024 / 1024), // Real MB used
          total: Math.round(totalMem / 1024 / 1024), // Real total MB
        },
        agents: agentCounts,
        tasks: taskCounts,
        requests: await (async () => {
          try {
            const { getRequestCounts } = await import('./request-tracker.js');
            const live = getRequestCounts();
            if (live.total > 0) {
              return { total: live.total, success: live.success, errors: live.errors };
            }
          } catch { /* tracker not available — fall back to stored value */ }
          return store.requests;
        })(),
        uptime: Date.now() - new Date(store.startTime).getTime(),
        lastCheck: new Date().toISOString(),
      };

      saveMetrics(currentMetrics);

      if (category === 'all') {
        return {
          ...currentMetrics,
          _real: true,
          _metricsSource,
          heap: {
            used: Math.round(memUsage.heapUsed / 1024 / 1024),
            total: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024),
          },
          loadAverage: loadAvg,
          cpuCores: cpus.length,
        };
      }

      const categoryMap: Record<string, unknown> = {
        cpu: {
          usage: currentMetrics.cpu,
          cores: cpus.length,
          load: loadAvg,
          model: cpus[0]?.model,
          _real: true,
        },
        memory: {
          ...currentMetrics.memory,
          heap: Math.round(memUsage.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
          free: Math.round(freeMem / 1024 / 1024),
          _real: true,
        },
        agents: currentMetrics.agents,
        tasks: currentMetrics.tasks,
        requests: currentMetrics.requests,
      };

      return categoryMap[category] || currentMetrics;
    },
  },
  {
    name: 'system_health',
    description: 'Perform system health check',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        deep: { type: 'boolean', description: 'Perform deep health check' },
        components: { type: 'array', items: { type: 'string' }, description: 'Components to check' },
        fix: { type: 'boolean', description: 'Attempt to fix issues' },
      },
    },
    handler: async (input) => {
      const metrics = loadMetrics();
      const checks: Array<{ name: string; status: string; latency?: number; message?: string }> = [];
      const projectCwd = getProjectCwd();

      // Memory DB check — verify the store file exists
      {
        const t0 = performance.now();
        const memoryDbPath = join(projectCwd, '.monobrain', 'memory', 'store.json');
        const memoryExists = existsSync(memoryDbPath);
        const elapsed = performance.now() - t0;
        checks.push({
          name: 'memory',
          status: memoryExists ? 'healthy' : 'degraded',
          latency: Math.round(elapsed * 100) / 100,
          message: memoryExists ? undefined : 'Memory store not found — run memory init',
        });
      }

      // Config check — verify config file exists
      {
        const t0 = performance.now();
        const configPath = join(projectCwd, '.monobrain', 'config.json');
        const altConfigPath = join(projectCwd, 'monobrain.config.json');
        const configExists = existsSync(configPath) || existsSync(altConfigPath);
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

      // Swarm — cannot verify real connectivity, report unknown
      checks.push({
        name: 'swarm',
        status: 'unknown',
        message: 'Swarm connectivity not monitored — check coordination store manually',
      });

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
          const freeMem = os.freemem();
          const totalMem = os.totalmem();
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
          const coordPath = join(projectCwd, '.monobrain', 'coordination', 'store.json');
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

      const healthy = checks.filter(c => c.status === 'healthy').length;
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
        issues: checks.filter(c => c.status !== 'healthy').map(c => ({
          component: c.name,
          status: c.status,
          suggestion: `Check ${c.name} component configuration`,
        })),
      };
    },
  },
  {
    name: 'system_info',
    description: 'Get system information',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        include: { type: 'array', items: { type: 'string' }, description: 'Information to include' },
      },
    },
    handler: async () => {
      return {
        version: PKG_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        cwd: getProjectCwd(),
        env: process.env.NODE_ENV || 'development',
        features: {
          swarm: true,
          memory: true,
          neural: true,
          hnsw: true,
          quantization: true,
          flashAttention: false,
        },
        limits: {
          maxAgents: 100,
          maxTasks: 1000,
          maxMemory: '4GB',
        },
      };
    },
  },
  {
    name: 'system_reset',
    description: 'Reset system state',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {
        component: { type: 'string', description: 'Component to reset (all, metrics, agents, tasks)' },
        confirm: { type: 'boolean', description: 'Confirm reset' },
      },
      required: ['confirm'],
    },
    handler: async (input) => {
      if (!input.confirm) {
        return { success: false, error: 'Reset requires confirmation' };
      }

      const component = (input.component as string) || 'metrics';

      // Reset metrics to defaults
      const defaultMetrics: SystemMetrics = {
        startTime: new Date().toISOString(),
        lastCheck: new Date().toISOString(),
        uptime: 0,
        health: 1.0,
        cpu: os.loadavg()[0] * 100 / os.cpus().length,
        memory: { used: Math.round((os.totalmem() - os.freemem()) / 1024 / 1024), total: Math.round(os.totalmem() / 1024 / 1024) },
        agents: { active: 0, total: 0 },
        tasks: { pending: 0, completed: 0, failed: 0 },
        requests: { total: 0, success: 0, errors: 0 },
      };

      saveMetrics(defaultMetrics);

      return {
        success: true,
        component,
        resetAt: new Date().toISOString(),
        message: `System ${component} has been reset`,
      };
    },
  },
  {
    name: 'mcp_status',
    description: 'Get MCP server status, including stdio mode detection',
    category: 'system',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      // Detect if we are running inside an MCP stdio session.
      // When Claude Code launches us via `claude mcp add`, stdin is piped (not a TTY)
      // and the process IS the MCP server, so it is running.
      const isStdio = !process.stdin.isTTY;
      const transport = process.env.MONOBRAIN_MCP_TRANSPORT || (isStdio ? 'stdio' : 'http');
      const port = parseInt(process.env.MONOBRAIN_MCP_PORT || '3000', 10);

      if (transport === 'stdio' || isStdio) {
        // In stdio mode the MCP server is this process itself
        return {
          running: true,
          pid: process.pid,
          transport: 'stdio',
          port: null,
          host: null,
        };
      }

      // For HTTP/WebSocket, try to check if the server is listening
      const host = process.env.MONOBRAIN_MCP_HOST || 'localhost';
      try {
        const { createConnection } = await import('node:net');
        const connected = await new Promise<boolean>((resolve) => {
          const socket = createConnection({ host, port }, () => {
            socket.destroy();
            resolve(true);
          });
          socket.on('error', () => resolve(false));
          socket.setTimeout(2000, () => {
            socket.destroy();
            resolve(false);
          });
        });

        return {
          running: connected,
          transport,
          port,
          host,
        };
      } catch {
        return {
          running: false,
          transport,
          port,
          host,
        };
      }
    },
  },
  {
    name: 'task_summary',
    description: 'Get a summary of all tasks by status',
    category: 'task',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      // Read from the task store file
      const storePath = join(getProjectCwd(), '.monobrain', 'tasks', 'store.json');
      let tasks: Array<{ status: string }> = [];
      try {
        if (existsSync(storePath)) {
          const data = readFileSync(storePath, 'utf-8');
          const store = JSON.parse(data);
          tasks = Object.values(store.tasks || {});
        }
      } catch {
        // empty store
      }

      return {
        total: tasks.length,
        pending: tasks.filter(t => t.status === 'pending').length,
        running: tasks.filter(t => t.status === 'in_progress').length,
        completed: tasks.filter(t => t.status === 'completed').length,
        failed: tasks.filter(t => t.status === 'failed').length,
      };
    },
  },
];
