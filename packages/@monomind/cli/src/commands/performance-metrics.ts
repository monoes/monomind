import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Metrics subcommand
export const metricsCommand: Command = {
  name: 'metrics',
  description: 'View and export performance metrics',
  options: [
    {
      name: 'timeframe',
      short: 't',
      type: 'string',
      description: 'Timeframe: 1h, 24h, 7d, 30d',
      default: '24h',
    },
    {
      name: 'format',
      short: 'f',
      type: 'string',
      description: 'Output format: text, json, prometheus',
      default: 'text',
    },
    { name: 'component', short: 'c', type: 'string', description: 'Component to filter' },
  ],
  examples: [
    { command: 'monomind performance metrics -t 7d', description: 'Show 7-day metrics' },
    {
      command: 'monomind performance metrics -f prometheus',
      description: 'Export as Prometheus format',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const timeframeRaw = (ctx.flags.timeframe as string) || '24h';
    const VALID_TIMEFRAMES = new Set(['1h', '24h', '7d', '30d']);
    const timeframe = VALID_TIMEFRAMES.has(timeframeRaw) ? timeframeRaw : '24h';
    const formatRaw = (ctx.flags.format as string) || 'text';
    const VALID_FORMATS = new Set(['text', 'json', 'prometheus']);
    const format = VALID_FORMATS.has(formatRaw) ? formatRaw : 'text';

    output.writeln();
    output.writeln(output.bold(`Performance Metrics (snapshot)`));
    output.writeln(output.dim('─'.repeat(50)));
    if (ctx.flags.timeframe) {
      output.writeln(
        output.warning(
          '--timeframe is not used for filtering: time history not recorded yet. Showing a live snapshot instead.',
        ),
      );
    }

    const os = await import('node:os');

    // Real system metrics
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    const loadAvg = os.loadavg();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();

    // Calculate real metrics
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(1);
    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);
    const memPercent = ((1 - freeMem / totalMem) * 100).toFixed(1);
    const cpuUserMs = (cpuUsage.user / 1000).toFixed(0);

    // Try to get HNSW/cache stats from real data
    let hnswEntries = 0;
    try {
      const { getHNSWStatus } = await import('../memory/memory-initializer.js');
      const status = await getHNSWStatus();
      hnswEntries = status?.entryCount || 0;
    } catch {
      /* HNSW not initialized */
    }

    // Try to get real cache stats — a real SELECT COUNT(*) via the memory
    // backend, not a file-size approximation.
    let cacheEntries = 0;
    try {
      const { bridgeGetBackendStats } = await import('../memory/memory-bridge.js');
      const stats = await bridgeGetBackendStats();
      cacheEntries = stats?.totalEntries ?? 0;
    } catch {
      /* no cache */
    }

    // Benchmark a quick operation to get real latency
    let avgLatencyMs = 0;
    try {
      const times: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await new Promise((r) => setImmediate(r)); // Event loop turn
        times.push(performance.now() - start);
      }
      avgLatencyMs = times.reduce((a, b) => a + b, 0) / times.length;
    } catch {
      /* timing failed */
    }

    // JSON/Prometheus output
    if (format === 'json') {
      const metrics = {
        timestamp: new Date().toISOString(),
        timeframe,
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          rss: memUsage.rss,
          external: memUsage.external,
          systemPercent: parseFloat(memPercent),
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
          loadAverage: loadAvg,
        },
        process: {
          uptime,
          pid: process.pid,
        },
        cache: {
          entries: cacheEntries,
          hnswEntries,
        },
        latency: {
          avgMs: avgLatencyMs,
        },
      };
      output.writeln(JSON.stringify(metrics, null, 2));
      return { success: true };
    }

    if (format === 'prometheus') {
      output.writeln(`# HELP monomind_heap_used_bytes Heap memory used`);
      output.writeln(`monomind_heap_used_bytes ${memUsage.heapUsed}`);
      output.writeln(`# HELP monomind_heap_total_bytes Total heap memory`);
      output.writeln(`monomind_heap_total_bytes ${memUsage.heapTotal}`);
      output.writeln(`# HELP monomind_rss_bytes Resident set size`);
      output.writeln(`monomind_rss_bytes ${memUsage.rss}`);
      output.writeln(`# HELP monomind_cpu_user_microseconds CPU user time`);
      output.writeln(`monomind_cpu_user_microseconds ${cpuUsage.user}`);
      output.writeln(`# HELP monomind_cpu_system_microseconds CPU system time`);
      output.writeln(`monomind_cpu_system_microseconds ${cpuUsage.system}`);
      output.writeln(`# HELP monomind_cache_entries Embedding cache entries`);
      output.writeln(`monomind_cache_entries ${cacheEntries}`);
      output.writeln(`# HELP monomind_hnsw_entries HNSW index entries`);
      output.writeln(`monomind_hnsw_entries ${hnswEntries}`);
      output.writeln(`# HELP monomind_uptime_seconds Process uptime`);
      output.writeln(`monomind_uptime_seconds ${uptime}`);
      return { success: true };
    }

    // Text table output with real values
    output.printTable({
      columns: [
        { key: 'metric', header: 'Metric', width: 25 },
        { key: 'current', header: 'Current', width: 15 },
        { key: 'limit', header: 'Limit', width: 15 },
        { key: 'status', header: 'Status', width: 12 },
      ],
      data: [
        {
          metric: 'Heap Memory',
          current: `${heapUsedMB} MB`,
          limit: `${heapTotalMB} MB`,
          status:
            parseFloat(heapUsedMB) < parseFloat(heapTotalMB) * 0.8
              ? output.success('OK')
              : output.warning('High'),
        },
        {
          metric: 'RSS Memory',
          current: `${rssMB} MB`,
          limit: '-',
          status: parseFloat(rssMB) < 500 ? output.success('OK') : output.warning('High'),
        },
        {
          metric: 'System Memory',
          current: `${memPercent}%`,
          limit: '100%',
          status: parseFloat(memPercent) < 80 ? output.success('OK') : output.warning('High'),
        },
        {
          metric: 'CPU User Time',
          current: `${cpuUserMs}ms`,
          limit: '-',
          status: output.success('OK'),
        },
        {
          metric: 'Event Loop Latency',
          current: `${avgLatencyMs.toFixed(2)}ms`,
          limit: '10ms',
          status: avgLatencyMs < 10 ? output.success('OK') : output.warning('Slow'),
        },
        {
          metric: 'HNSW Index',
          current: `${hnswEntries} entries`,
          limit: '-',
          status: hnswEntries > 0 ? output.success('Active') : output.dim('Empty'),
        },
        {
          metric: 'Embedding Cache',
          current: `${cacheEntries} entries`,
          limit: '-',
          status: cacheEntries > 0 ? output.success('Active') : output.dim('Empty'),
        },
        {
          metric: 'Process Uptime',
          current: `${Math.floor(uptime)}s`,
          limit: '-',
          status: output.success('Running'),
        },
      ],
    });

    output.writeln();
    output.writeln(output.dim(`Load Average: ${loadAvg.map((l) => l.toFixed(2)).join(', ')}`));
    output.writeln(
      output.dim(`CPUs: ${os.cpus().length} | Platform: ${os.platform()} ${os.release()}`),
    );

    return { success: true };
  },
};
