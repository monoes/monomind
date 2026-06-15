/**
 * CLI Guidance Command
 * Guidance Control Plane - compile, retrieve, enforce, optimize
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

// compile subcommand
const compileCommand: Command = {
  name: 'compile',
  description: 'Compile CLAUDE.md into a policy bundle (constitution + shards + manifest)',
  options: [
    { name: 'root', short: 'r', type: 'string', description: 'Root guidance file path', default: './CLAUDE.md' },
    { name: 'local', short: 'l', type: 'string', description: 'Local guidance overlay file path' },
    { name: 'output', short: 'o', type: 'string', description: 'Output directory for compiled bundle' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  examples: [
    { command: 'monomind guidance compile', description: 'Compile default CLAUDE.md' },
    { command: 'monomind guidance compile -r ./CLAUDE.md -l ./CLAUDE.local.md', description: 'Compile with local overlay' },
    { command: 'monomind guidance compile --json', description: 'Output compiled bundle as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rootPath = ctx.flags.root as string || './CLAUDE.md';
    const localPath = ctx.flags.local as string | undefined;
    const jsonOutput = ctx.flags.json === true;

    output.writeln();
    output.writeln(output.bold('Guidance Compiler'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');

      if (!existsSync(rootPath)) {
        output.writeln(output.error(`Root guidance file not found: ${rootPath}`));
        return { success: false, message: `File not found: ${rootPath}` };
      }

      const rootContent = await readFile(rootPath, 'utf-8');
      let localContent: string | undefined;
      if (localPath && existsSync(localPath)) {
        localContent = await readFile(localPath, 'utf-8');
      }

      const { GuidanceCompiler } = await import('@monomind/guidance/compiler');
      const compiler = new GuidanceCompiler();
      const bundle = compiler.compile(rootContent, localContent);

      if (jsonOutput) {
        output.writeln(JSON.stringify(bundle, null, 2));
      } else {
        output.writeln(output.success('Compiled successfully'));
        output.writeln();
        output.writeln(`  Constitution rules: ${output.bold(String(bundle.constitution.rules.length))}`);
        output.writeln(`  Constitution hash:  ${output.dim(bundle.constitution.hash)}`);
        output.writeln(`  Shard count:        ${output.bold(String(bundle.shards.length))}`);
        output.writeln(`  Total rules:        ${output.bold(String(bundle.manifest.totalRules))}`);
        output.writeln(`  Compiled at:        ${output.dim(new Date(bundle.manifest.compiledAt).toISOString())}`);

        if (localContent) {
          output.writeln(`  Local overlay:      ${output.success('applied')}`);
        }

        output.writeln();
        output.writeln(output.dim('Rule summary:'));
        for (const rule of bundle.manifest.rules.slice(0, 10)) {
          const risk = rule.riskClass === 'critical' ? output.error(rule.riskClass) :
            rule.riskClass === 'high' ? output.warning(rule.riskClass) :
              output.dim(rule.riskClass);
          output.writeln(`  ${output.bold(rule.id)} [${risk}] ${rule.source.slice(0, 60)}${rule.source.length > 60 ? '...' : ''}`);
        }
        if (bundle.manifest.rules.length > 10) {
          output.writeln(output.dim(`  ... and ${bundle.manifest.rules.length - 10} more`));
        }
      }

      return { success: true, data: bundle };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`Compilation failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// retrieve subcommand
const retrieveCommand: Command = {
  name: 'retrieve',
  description: 'Retrieve task-relevant guidance shards for a given task description',
  options: [
    { name: 'task', short: 't', type: 'string', description: 'Task description', required: true },
    { name: 'root', short: 'r', type: 'string', description: 'Root guidance file path', default: './CLAUDE.md' },
    { name: 'local', short: 'l', type: 'string', description: 'Local overlay file path' },
    { name: 'max-shards', short: 'n', type: 'number', description: 'Maximum number of shards to retrieve', default: '5' },
    { name: 'intent', short: 'i', type: 'string', description: 'Override detected intent' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  examples: [
    { command: 'monomind guidance retrieve -t "Fix SQL injection in user search"', description: 'Retrieve guidance for a security task' },
    { command: 'monomind guidance retrieve -t "Add unit tests" -n 3', description: 'Retrieve top 3 shards for testing' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const task = ctx.flags.task as string;
    const rootPath = ctx.flags.root as string || './CLAUDE.md';
    const localPath = ctx.flags.local as string | undefined;
    const maxShards = parseInt(ctx.flags['max-shards'] as string || '5', 10);
    const intentOverride = ctx.flags.intent as string | undefined;
    const jsonOutput = ctx.flags.json === true;

    if (!task) {
      output.writeln(output.error('Task description is required (-t "...")'));
      return { success: false, message: 'Missing task description' };
    }

    output.writeln();
    output.writeln(output.bold('Guidance Retriever'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { GuidanceCompiler } = await import('@monomind/guidance/compiler');
      const { ShardRetriever, HashEmbeddingProvider } = await import('@monomind/guidance/retriever');

      if (!existsSync(rootPath)) {
        output.writeln(output.error(`Root guidance file not found: ${rootPath}`));
        return { success: false, message: `File not found: ${rootPath}` };
      }

      const rootContent = await readFile(rootPath, 'utf-8');
      let localContent: string | undefined;
      if (localPath && existsSync(localPath)) {
        localContent = await readFile(localPath, 'utf-8');
      }

      const compiler = new GuidanceCompiler();
      const bundle = compiler.compile(rootContent, localContent);

      const retriever = new ShardRetriever(new HashEmbeddingProvider(128));
      await retriever.loadBundle(bundle);

      const result = await retriever.retrieve({
        taskDescription: task,
        maxShards,
        intent: intentOverride as any,
      });

      if (jsonOutput) {
        output.writeln(JSON.stringify(result, null, 2));
      } else {
        output.writeln(`  Detected intent: ${output.bold(result.detectedIntent)}`);
        output.writeln(`  Retrieval time:  ${output.dim(result.latencyMs + 'ms')}`);
        output.writeln(`  Constitution:    ${output.bold(String(result.constitution.rules.length))} rules`);
        output.writeln(`  Shards:          ${output.bold(String(result.shards.length))} retrieved`);
        output.writeln();

        if (result.shards.length > 0) {
          output.writeln(output.dim('Retrieved shards:'));
          for (const shard of result.shards) {
            output.writeln(`  ${output.bold(shard.shard.rule.id)} [${shard.shard.rule.riskClass}] ${shard.shard.rule.text.slice(0, 60)}`);
          }
        }

        output.writeln();
        output.writeln(output.dim('Policy text preview:'));
        const lines = result.policyText.split('\n').slice(0, 15);
        for (const line of lines) {
          output.writeln(`  ${line}`);
        }
        if (result.policyText.split('\n').length > 15) {
          output.writeln(output.dim('  ...'));
        }
      }

      return { success: true, data: result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`Retrieval failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// gates subcommand
const gatesCommand: Command = {
  name: 'gates',
  description: 'Evaluate enforcement gates against a command or content',
  options: [
    { name: 'command', short: 'c', type: 'string', description: 'Command to evaluate' },
    { name: 'content', type: 'string', description: 'Content to check for secrets' },
    { name: 'tool', short: 't', type: 'string', description: 'Tool name to check against allowlist' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  examples: [
    { command: 'monomind guidance gates -c "rm -rf /tmp"', description: 'Check if a command is destructive' },
    { command: 'monomind guidance gates --content "api_key=sk-abc123..."', description: 'Check content for secrets' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const command = ctx.flags.command as string | undefined;
    const content = ctx.flags.content as string | undefined;
    const tool = ctx.flags.tool as string | undefined;
    const jsonOutput = ctx.flags.json === true;

    output.writeln();
    output.writeln(output.bold('Enforcement Gates'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { EnforcementGates } = await import('@monomind/guidance/gates');
      const gates = new EnforcementGates();

      const results: Array<{ type: string; result: any }> = [];

      if (command) {
        const gateResults = gates.evaluateCommand(command);
        results.push({ type: 'command', result: gateResults });
      }

      if (content) {
        const secretResult = gates.evaluateSecrets(content);
        results.push({ type: 'secrets', result: secretResult });
      }

      if (tool) {
        const toolResult = gates.evaluateToolAllowlist(tool);
        // evaluateToolAllowlist returns null when allowedTools is empty (no allowlist configured)
        if (toolResult === null) {
          output.writeln(output.warning(`  tool-allowlist: no tools configured — all tools pass by default. Use a GuidanceControlPlane with allowedTools to restrict.`));
        }
        results.push({ type: 'tool-allowlist', result: toolResult });
      }

      if (results.length === 0) {
        output.writeln(output.warning('No input provided. Use -c, --content, or -t to evaluate.'));
        return { success: false, message: 'No input' };
      }

      if (jsonOutput) {
        output.writeln(JSON.stringify(results, null, 2));
      } else {
        for (const { type, result } of results) {
          output.writeln(`  ${output.bold(type)}:`);
          if (result === null) {
            output.writeln(`    ${output.success('ALLOW')} - No gate triggered`);
          } else if (Array.isArray(result)) {
            if (result.length === 0) {
              output.writeln(`    ${output.success('ALLOW')} - All gates passed`);
            } else {
              for (const r of result) {
                const color = r.decision === 'block' ? output.error.bind(output) :
                  r.decision === 'require-confirmation' ? output.warning.bind(output) :
                    output.dim.bind(output);
                output.writeln(`    ${color(r.decision.toUpperCase())} [${r.gateName}] ${r.reason}`);
                if (r.remediation) {
                  output.writeln(`      Remediation: ${output.dim(r.remediation)}`);
                }
              }
            }
          } else {
            const color = result.decision === 'block' ? output.error.bind(output) :
              result.decision === 'require-confirmation' ? output.warning.bind(output) :
                output.dim.bind(output);
            output.writeln(`    ${color(result.decision.toUpperCase())} [${result.gateName}] ${result.reason}`);
            if (result.remediation) {
              output.writeln(`      Remediation: ${output.dim(result.remediation)}`);
            }
          }
        }
      }

      return { success: true, data: results };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`Gate evaluation failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// status subcommand
const statusCommand: Command = {
  name: 'status',
  description: 'Show guidance control plane status and metrics',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const jsonOutput = ctx.flags.json === true;

    output.writeln();
    output.writeln(output.bold('Guidance Control Plane Status'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { existsSync } = await import('node:fs');

      const rootExists = existsSync('./CLAUDE.md');
      const localExists = existsSync('./CLAUDE.local.md');

      const statusData = {
        rootGuidance: rootExists ? 'found' : 'not found',
        localOverlay: localExists ? 'found' : 'not configured',
        dataDir: existsSync('./.monomind/guidance') ? 'exists' : 'not created',
      };

      if (jsonOutput) {
        output.writeln(JSON.stringify(statusData, null, 2));
      } else {
        output.writeln(`  Root guidance:  ${rootExists ? output.success('CLAUDE.md found') : output.warning('CLAUDE.md not found')}`);
        output.writeln(`  Local overlay:  ${localExists ? output.success('CLAUDE.local.md found') : output.dim('not configured')}`);
        output.writeln(`  Data directory: ${statusData.dataDir === 'exists' ? output.success('exists') : output.dim('not created')}`);

        if (rootExists) {
          const { readFile } = await import('node:fs/promises');
          const { GuidanceCompiler } = await import('@monomind/guidance/compiler');
          const rootContent = await readFile('./CLAUDE.md', 'utf-8');
          const compiler = new GuidanceCompiler();
          const bundle = compiler.compile(rootContent);

          output.writeln();
          output.writeln(output.dim('Compiled bundle:'));
          output.writeln(`  Constitution rules: ${output.bold(String(bundle.constitution.rules.length))}`);
          output.writeln(`  Shard count:        ${output.bold(String(bundle.shards.length))}`);
          output.writeln(`  Total rules:        ${output.bold(String(bundle.manifest.totalRules))}`);
          output.writeln(`  Hash:               ${output.dim(bundle.constitution.hash)}`);
        }
      }

      return { success: true, data: statusData };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`Status check failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// optimize subcommand
const optimizeCommand: Command = {
  name: 'optimize',
  description: 'Analyze and optimize a CLAUDE.md file for structure, coverage, and enforceability',
  options: [
    { name: 'root', short: 'r', type: 'string', description: 'Root guidance file path', default: './CLAUDE.md' },
    { name: 'local', short: 'l', type: 'string', description: 'Local overlay file path' },
    { name: 'apply', short: 'a', type: 'boolean', description: 'Apply optimizations to the file', default: 'false' },
    { name: 'context-size', short: 's', type: 'string', description: 'Target context size: compact, standard, full', default: 'standard' },
    { name: 'target-score', type: 'number', description: 'Target composite score (0-100)', default: '90' },
    { name: 'max-iterations', type: 'number', description: 'Maximum optimization iterations', default: '5' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  examples: [
    { command: 'monomind guidance optimize', description: 'Analyze current CLAUDE.md and show suggestions' },
    { command: 'monomind guidance optimize --apply', description: 'Apply optimizations to CLAUDE.md' },
    { command: 'monomind guidance optimize -s compact --apply', description: 'Optimize for compact context window' },
    { command: 'monomind guidance optimize --target-score 95', description: 'Optimize until score reaches 95' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const rootPath = ctx.flags.root as string || './CLAUDE.md';
    const localPath = ctx.flags.local as string | undefined;
    const applyChanges = ctx.flags.apply === true;
    const contextSize = (ctx.flags['context-size'] as string || 'standard') as 'compact' | 'standard' | 'full';
    const targetScore = parseInt(ctx.flags['target-score'] as string || '90', 10);
    const maxIterations = parseInt(ctx.flags['max-iterations'] as string || '5', 10);
    const jsonOutput = ctx.flags.json === true;

    output.writeln();
    output.writeln(output.bold('Guidance Optimizer'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { readFile, writeFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');

      if (!existsSync(rootPath)) {
        output.writeln(output.error(`Root guidance file not found: ${rootPath}`));
        return { success: false, message: `File not found: ${rootPath}` };
      }

      const rootContent = await readFile(rootPath, 'utf-8');
      let localContent: string | undefined;
      if (localPath && existsSync(localPath)) {
        localContent = await readFile(localPath, 'utf-8');
      }

      // Step 1: Analyze current state
      const { analyze, formatReport, optimizeForSize, formatBenchmark } = await import('@monomind/guidance/analyzer');
      const analysis = analyze(rootContent, localContent);

      if (jsonOutput && !applyChanges) {
        output.writeln(JSON.stringify(analysis, null, 2));
        return { success: true, data: analysis };
      }

      // Show current analysis
      output.writeln(formatReport(analysis));
      output.writeln();

      if (analysis.compositeScore >= targetScore) {
        output.writeln(output.success(`Score ${analysis.compositeScore}/100 already meets target ${targetScore}. No optimization needed.`));
        return { success: true, data: analysis };
      }

      // Step 2: Run optimization
      output.writeln(output.dim(`Optimizing (target: ${targetScore}, context: ${contextSize}, max iterations: ${maxIterations})...`));

      const result = optimizeForSize(rootContent, {
        contextSize,
        localContent,
        maxIterations,
        targetScore,
      });

      if (jsonOutput) {
        output.writeln(JSON.stringify({
          before: analysis,
          after: result.benchmark.after,
          delta: result.benchmark.delta,
          steps: result.appliedSteps,
        }, null, 2));
        return { success: true, data: result };
      }

      // Show benchmark comparison
      output.writeln();
      output.writeln(formatBenchmark(result.benchmark));
      output.writeln();

      if (result.appliedSteps.length > 0) {
        output.writeln(`Applied ${output.bold(String(result.appliedSteps.length))} optimization steps:`);
        for (const step of result.appliedSteps) {
          output.writeln(`  ${output.success('+')} ${step}`);
        }
        output.writeln();
      }

      // Step 3: Apply if requested
      if (applyChanges) {
        await writeFile(rootPath, result.optimized, 'utf-8');
        output.writeln(output.success(`Optimized CLAUDE.md written to ${rootPath}`));
        output.writeln(`  Before: ${analysis.compositeScore}/100 (${analysis.grade})`);
        output.writeln(`  After:  ${result.benchmark.after.compositeScore}/100 (${result.benchmark.after.grade})`);
        output.writeln(`  Delta:  ${result.benchmark.delta >= 0 ? '+' : ''}${result.benchmark.delta}`);
      } else {
        output.writeln(output.warning('Dry run - use --apply to write changes.'));
        output.writeln(`  Projected: ${analysis.compositeScore} → ${result.benchmark.after.compositeScore}/100`);
      }

      return { success: true, data: result };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`Optimization failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// ab-test subcommand
const abTestCommand: Command = {
  name: 'ab-test',
  description: 'Run A/B behavioral comparison between two CLAUDE.md versions',
  options: [
    { name: 'config-a', short: 'a', type: 'string', description: 'Path to Config A (baseline CLAUDE.md). Defaults to no guidance.' },
    { name: 'config-b', short: 'b', type: 'string', description: 'Path to Config B (candidate CLAUDE.md)', default: './CLAUDE.md' },
    { name: 'tasks', short: 't', type: 'string', description: 'Path to custom task JSON file (array of ABTask objects)' },
    { name: 'work-dir', short: 'w', type: 'string', description: 'Working directory for test execution' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: 'false' },
  ],
  examples: [
    { command: 'monomind guidance ab-test', description: 'Run default A/B test (no guidance vs ./CLAUDE.md)' },
    { command: 'monomind guidance ab-test -a old.md -b new.md', description: 'Compare two CLAUDE.md versions' },
    { command: 'monomind guidance ab-test --tasks custom-tasks.json', description: 'Run with custom test tasks' },
    { command: 'monomind guidance ab-test --json', description: 'Output full report as JSON' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const configAPath = ctx.flags['config-a'] as string | undefined;
    const configBPath = ctx.flags['config-b'] as string || './CLAUDE.md';
    const tasksPath = ctx.flags.tasks as string | undefined;
    const workDir = ctx.flags['work-dir'] as string | undefined;
    const jsonOutput = ctx.flags.json === true;

    output.writeln();
    output.writeln(output.bold('A/B Behavioral Benchmark'));
    output.writeln(output.dim('─'.repeat(50)));

    try {
      const { readFile } = await import('node:fs/promises');
      const { existsSync } = await import('node:fs');
      const { abBenchmark, getDefaultABTasks } = await import('@monomind/guidance/analyzer');

      // Load Config B (candidate) content
      if (!existsSync(configBPath)) {
        output.writeln(output.error(`Config B file not found: ${configBPath}`));
        return { success: false, message: `File not found: ${configBPath}` };
      }
      const configBContent = await readFile(configBPath, 'utf-8');

      // Optionally load Config A for display context
      let configALabel = 'No control plane (baseline)';
      if (configAPath) {
        if (!existsSync(configAPath)) {
          output.writeln(output.error(`Config A file not found: ${configAPath}`));
          return { success: false, message: `File not found: ${configAPath}` };
        }
        configALabel = configAPath;
      }

      // Load custom tasks if provided
      let customTasks: undefined | any[];
      if (tasksPath) {
        if (!existsSync(tasksPath)) {
          output.writeln(output.error(`Tasks file not found: ${tasksPath}`));
          return { success: false, message: `File not found: ${tasksPath}` };
        }
        // Size guard: a multi-MB tasks file would be buffered in full before
        // JSON.parse runs. Cap at 10 MB — any legitimate task list is far smaller.
        const { statSync, lstatSync } = await import('node:fs');
        const tasksLstat = lstatSync(tasksPath);
        if (tasksLstat.isSymbolicLink()) {
          output.writeln(output.error(`Symlinks are not allowed as task files: ${tasksPath}`));
          return { success: false, message: 'Symlink not allowed as tasks file' };
        }
        const MAX_TASKS_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
        if (tasksLstat.size > MAX_TASKS_FILE_BYTES) {
          output.writeln(output.error(`Tasks file too large (max 10 MB): ${tasksPath}`));
          return { success: false, message: 'Tasks file too large' };
        }
        const tasksJson = await readFile(tasksPath, 'utf-8');
        customTasks = JSON.parse(tasksJson);
        output.writeln(`  Custom tasks: ${output.bold(String(customTasks!.length))} loaded from ${tasksPath}`);
      }

      output.writeln(`  Config A: ${output.dim(configALabel)}`);
      output.writeln(`  Config B: ${output.dim(configBPath)}`);
      output.writeln(`  Tasks:    ${output.dim(customTasks ? `${customTasks.length} custom` : `${getDefaultABTasks().length} default`)}`);
      output.writeln();
      output.writeln(output.dim('Running benchmark...'));

      // Run the A/B benchmark
      const report = await abBenchmark(configBContent, {
        tasks: customTasks,
        workDir,
      });

      if (jsonOutput) {
        output.writeln(JSON.stringify({
          configA: { label: configALabel, metrics: report.configA.metrics },
          configB: { label: configBPath, metrics: report.configB.metrics },
          compositeDelta: report.compositeDelta,
          classDeltas: report.classDeltas,
          categoryShift: report.categoryShift,
          taskResults: {
            configA: report.configA.taskResults.map(r => ({
              taskId: r.taskId, taskClass: r.taskClass, passed: r.passed,
              violations: r.violations.length, toolCalls: r.toolCalls,
            })),
            configB: report.configB.taskResults.map(r => ({
              taskId: r.taskId, taskClass: r.taskClass, passed: r.passed,
              violations: r.violations.length, toolCalls: r.toolCalls,
            })),
          },
        }, null, 2));
        return { success: true, data: report };
      }

      // Print formatted report
      output.writeln(report.report);
      output.writeln();

      // Summary verdict
      const delta = report.compositeDelta;
      if (delta > 0.05) {
        output.writeln(output.success(`Config B is better (+${delta} composite delta)`));
      } else if (delta < -0.05) {
        output.writeln(output.error(`Config B is worse (${delta} composite delta)`));
      } else {
        output.writeln(output.warning(`No significant difference (${delta} composite delta)`));
      }

      if (report.categoryShift) {
        output.writeln(output.success('Category shift detected: 3+ task classes improved by 20%+'));
      }

      return { success: true, data: report };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      output.writeln(output.error(`A/B benchmark failed: ${msg}`));
      return { success: false, message: msg };
    }
  },
};

// setup subcommand
const setupCommand: Command = {
  name: 'setup',
  description: 'Wire enforcement gates into Claude Code hooks (destructive-ops + secrets)',
  options: [
    { name: 'dry-run', type: 'boolean', description: 'Show what would change without writing', default: 'false' },
    { name: 'force', type: 'boolean', description: 'Overwrite existing gate hooks', default: 'false' },
    { name: 'project-dir', short: 'p', type: 'string', description: 'Project directory (default: cwd)' },
  ],
  examples: [
    { command: 'monomind guidance setup', description: 'Wire gates into .claude/settings.json' },
    { command: 'monomind guidance setup --dry-run', description: 'Preview changes without writing' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const dryRun = ctx.flags['dry-run'] === true;
    const force = ctx.flags.force === true;
    const projectDir = (ctx.flags['project-dir'] as string | undefined) || ctx.cwd;

    output.writeln();
    output.writeln(output.bold('Guidance Gates Setup'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const { readFileSync, writeFileSync, existsSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');

    const settingsPath = join(projectDir, '.claude', 'settings.json');
    const gatesHandlerPath = join(projectDir, '.claude', 'helpers', 'handlers', 'gates-handler.cjs');

    // Verify the gate handler exists
    if (!existsSync(gatesHandlerPath)) {
      output.writeln(output.error('gates-handler.cjs not found. Run `monomind init` first to set up the helpers directory.'));
      return { success: false, message: 'gates-handler.cjs missing' };
    }

    // Load or create settings.json
    let settings: Record<string, unknown> = {};
    if (existsSync(settingsPath) && statSync(settingsPath).size <= 1024 * 1024) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
      } catch {
        output.writeln(output.error(`Could not parse ${settingsPath}`));
        return { success: false, message: 'settings.json parse error' };
      }
    }

    const hooks = (settings.hooks || {}) as Record<string, unknown[]>;
    const preToolUse: Array<{ matcher?: string; hooks: Array<{ type: string; command: string; timeout?: number }> }> =
      (hooks.PreToolUse as typeof preToolUse) || [];

    const PRE_BASH_MATCHER = 'Bash';
    const PRE_BASH_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-bash';
    const PRE_WRITE_MATCHER = 'Write|Edit|MultiEdit';
    const PRE_WRITE_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/helpers/hook-handler.cjs" pre-write';

    // Find any existing Bash/Write entry (may have different hooks from other tools)
    const existingBashEntry = preToolUse.find(e => e.matcher === PRE_BASH_MATCHER);
    const alreadyHasPreBash = existingBashEntry?.hooks.some(h => h.command.includes('pre-bash')) ?? false;
    const existingWriteEntry = preToolUse.find(e => e.matcher === PRE_WRITE_MATCHER);
    const alreadyHasPreWrite = existingWriteEntry?.hooks.some(h => h.command.includes('pre-write')) ?? false;

    const changes: string[] = [];

    // Register pre-bash (destructive-ops gate)
    if (alreadyHasPreBash && !force) {
      output.writeln(output.dim(`  ✓ PreToolUse[${PRE_BASH_MATCHER}]              → pre-bash   (already registered)`));
    } else {
      if (force && existingBashEntry) {
        // Remove only the old pre-bash hook from an existing Bash entry (preserve other hooks)
        existingBashEntry.hooks = existingBashEntry.hooks.filter(h => !h.command.includes('pre-bash'));
      }
      const newHook = { type: 'command', command: PRE_BASH_COMMAND, timeout: 5000 };
      if (existingBashEntry) {
        // Merge into existing Bash entry — avoids creating a duplicate top-level Bash matcher
        existingBashEntry.hooks.push(newHook);
      } else {
        preToolUse.push({ matcher: PRE_BASH_MATCHER, hooks: [newHook] });
      }
      changes.push(`PreToolUse[${PRE_BASH_MATCHER}] → pre-bash (destructive-ops gate)`);
      output.writeln(output.success(`  + PreToolUse[${PRE_BASH_MATCHER}]              → pre-bash   (destructive-ops gate)`));
    }

    // Register pre-write (secrets gate)
    if (alreadyHasPreWrite && !force) {
      output.writeln(output.dim(`  ✓ PreToolUse[${PRE_WRITE_MATCHER}] → pre-write  (already registered)`));
    } else {
      if (force && existingWriteEntry) {
        // Remove only the old pre-write hook from an existing Write entry (preserve other hooks)
        existingWriteEntry.hooks = existingWriteEntry.hooks.filter(h => !h.command.includes('pre-write'));
      }
      const newWriteHook = { type: 'command', command: PRE_WRITE_COMMAND, timeout: 3000 };
      if (existingWriteEntry) {
        // Merge into existing Write entry — avoids creating a duplicate top-level Write|Edit|MultiEdit matcher
        existingWriteEntry.hooks.push(newWriteHook);
      } else {
        preToolUse.push({ matcher: PRE_WRITE_MATCHER, hooks: [newWriteHook] });
      }
      changes.push(`PreToolUse[${PRE_WRITE_MATCHER}] → pre-write (secrets detection)`);
      output.writeln(output.success(`  + PreToolUse[${PRE_WRITE_MATCHER}] → pre-write  (secrets gate)`));
    }

    if (changes.length === 0) {
      output.writeln();
      output.writeln(output.dim('Nothing to change.'));
      return { success: true, data: { changes: [] } };
    }

    if (dryRun) {
      output.writeln();
      output.writeln(output.dim(`Dry run — would write ${settingsPath}`));
      return { success: true, data: { changes, dryRun: true } };
    }

    // Write back
    hooks.PreToolUse = preToolUse;
    settings.hooks = hooks;
    try {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Failed to write ${settingsPath}: ${msg}` };
    }

    output.writeln();
    output.writeln(output.success(`Wrote ${settingsPath}`));
    output.writeln();
    output.writeln(output.dim('Gates active on next Claude Code session:'));
    output.writeln(output.dim('  • Bash commands checked for destructive operations (rm -rf, DROP TABLE, git push --force …)'));
    output.writeln(output.dim('  • Write/Edit/MultiEdit checked for secrets (API keys, tokens, private keys …)'));

    return { success: true, data: { changes } };
  },
};

// Main guidance command
export const guidanceCommand: Command = {
  name: 'guidance',
  description: 'Guidance Control Plane - compile, retrieve, enforce, and optimize guidance rules',
  aliases: ['guide', 'policy'],
  subcommands: [
    compileCommand,
    retrieveCommand,
    gatesCommand,
    statusCommand,
    optimizeCommand,
    abTestCommand,
    setupCommand,
  ],
  options: [],
  examples: [
    { command: 'monomind guidance compile', description: 'Compile CLAUDE.md into policy bundle' },
    { command: 'monomind guidance retrieve -t "Fix auth bug"', description: 'Retrieve relevant guidance' },
    { command: 'monomind guidance gates -c "rm -rf /"', description: 'Check enforcement gates' },
    { command: 'monomind guidance status', description: 'Show control plane status' },
    { command: 'monomind guidance optimize', description: 'Analyze and optimize CLAUDE.md' },
    { command: 'monomind guidance ab-test', description: 'Run A/B behavioral comparison' },
    { command: 'monomind guidance setup', description: 'Wire enforcement gates into Claude Code hooks' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    output.writeln();
    output.writeln(output.bold('Guidance Control Plane'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();
    output.writeln('Available subcommands:');
    output.writeln(`  ${output.bold('compile')}   Compile CLAUDE.md into policy bundle`);
    output.writeln(`  ${output.bold('retrieve')}  Retrieve task-relevant guidance shards`);
    output.writeln(`  ${output.bold('gates')}     Evaluate enforcement gates`);
    output.writeln(`  ${output.bold('status')}    Show control plane status`);
    output.writeln(`  ${output.bold('optimize')}  Analyze and optimize CLAUDE.md`);
    output.writeln(`  ${output.bold('ab-test')}   Run A/B behavioral comparison`);
    output.writeln(`  ${output.bold('setup')}     Wire enforcement gates into Claude Code hooks`);
    output.writeln();
    output.writeln(output.dim('Use monomind guidance <subcommand> --help for details'));

    return { success: true };
  },
};

export default guidanceCommand;
