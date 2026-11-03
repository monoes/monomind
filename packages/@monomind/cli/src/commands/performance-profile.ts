import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

// Profile subcommand
export const profileCommand: Command = {
  name: 'profile',
  description: 'Profile application performance',
  options: [
    {
      name: 'type',
      short: 't',
      type: 'string',
      description: 'Profile type: cpu, memory, io, all',
      default: 'all',
    },
    {
      name: 'duration',
      short: 'd',
      type: 'number',
      description: 'Duration in seconds',
      default: '30',
    },
    { name: 'output', short: 'o', type: 'string', description: 'Output file for profile data' },
  ],
  examples: [
    { command: 'monomind performance profile -t cpu', description: 'Profile CPU usage' },
    { command: 'monomind performance profile -d 60', description: 'Profile for 60 seconds' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const durationRaw = parseInt((ctx.flags.duration as string) || '30', 10);
    const duration = Number.isFinite(durationRaw) ? Math.min(Math.max(1, durationRaw), 300) : 30;

    output.writeln();
    output.writeln(output.bold('Performance Profiler'));
    output.writeln(output.dim('─'.repeat(50)));

    const spinner = output.createSpinner({ text: 'Collecting profile data...', spinner: 'dots' });
    spinner.start();

    // Collect real metrics
    const startCpu = process.cpuUsage();
    const startTime = process.hrtime.bigint();

    // Sample for a brief period
    await new Promise((r) => setTimeout(r, Math.min(duration * 1000, 30_000)));

    const endCpu = process.cpuUsage(startCpu);
    const endMem = process.memoryUsage();
    const endTime = process.hrtime.bigint();

    spinner.succeed('Profile complete');

    // Calculate real values
    const elapsedMs = Number(endTime - startTime) / 1_000_000;
    const cpuPercent = (((endCpu.user + endCpu.system) / 1000 / elapsedMs) * 100).toFixed(1);
    const heapUsedMB = (endMem.heapUsed / 1024 / 1024).toFixed(1);
    const heapTotalMB = (endMem.heapTotal / 1024 / 1024).toFixed(1);
    const rssMB = (endMem.rss / 1024 / 1024).toFixed(1);
    const externalMB = (endMem.external / 1024 / 1024).toFixed(1);

    // Get event loop lag (approximate)
    const lagStart = Date.now();
    await new Promise((r) => setImmediate(r));
    const eventLoopLag = (Date.now() - lagStart).toFixed(1);

    // Determine status based on thresholds
    const heapStatus =
      endMem.heapUsed / endMem.heapTotal > 0.9
        ? output.error('High')
        : endMem.heapUsed / endMem.heapTotal > 0.7
          ? output.warning('Elevated')
          : output.success('Normal');
    const lagStatus =
      parseFloat(eventLoopLag) > 50
        ? output.error('High')
        : parseFloat(eventLoopLag) > 10
          ? output.warning('Elevated')
          : output.success('Normal');

    output.writeln();
    output.printTable({
      columns: [
        { key: 'metric', header: 'Metric', width: 25 },
        { key: 'current', header: 'Current', width: 15 },
        { key: 'peak', header: 'Peak/Total', width: 15 },
        { key: 'status', header: 'Status', width: 15 },
      ],
      data: [
        {
          metric: 'CPU Usage',
          current: `${cpuPercent}%`,
          peak: '-',
          status: output.success('Sampled'),
        },
        {
          metric: 'Memory (Heap Used)',
          current: `${heapUsedMB} MB`,
          peak: `${heapTotalMB} MB`,
          status: heapStatus,
        },
        {
          metric: 'Memory (RSS)',
          current: `${rssMB} MB`,
          peak: '-',
          status: output.success('Normal'),
        },
        {
          metric: 'Memory (External)',
          current: `${externalMB} MB`,
          peak: '-',
          status: output.success('Normal'),
        },
        { metric: 'Event Loop Lag', current: `${eventLoopLag}ms`, peak: '-', status: lagStatus },
        {
          metric: 'Node.js Uptime',
          current: `${process.uptime().toFixed(1)}s`,
          peak: '-',
          status: output.success('Running'),
        },
      ],
    });

    output.writeln();
    output.writeln(output.dim(`Profile duration: ${elapsedMs.toFixed(0)}ms`));

    const outputFile = ctx.flags.output as string | undefined;
    if (outputFile) {
      const profileData = {
        timestamp: new Date().toISOString(),
        duration_ms: Math.round(elapsedMs),
        cpu: { user_us: endCpu.user, system_us: endCpu.system, percent: parseFloat(cpuPercent) },
        memory: {
          heap_used_mb: parseFloat(heapUsedMB),
          heap_total_mb: parseFloat(heapTotalMB),
          rss_mb: parseFloat(rssMB),
          external_mb: parseFloat(externalMB),
        },
        event_loop_lag_ms: parseFloat(eventLoopLag),
      };
      const fs = await import('node:fs');
      const path = await import('node:path');
      const resolved = path.resolve(outputFile);
      fs.writeFileSync(resolved, `${JSON.stringify(profileData, null, 2)}\n`);
      output.writeln(output.success(`Profile data saved to ${resolved}`));
    }

    return { success: true };
  },
};
