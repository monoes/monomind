/**
 * CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * github.com/monoes/monomind
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import {
  checkNodeVersion, checkNpmVersion, checkGit, checkGitRepo,
  checkDiskSpace, checkBuildTools, checkVersionFreshness, checkClaudeCode,
  installClaudeCode,
} from './doctor-env-checks.js';
import type { HealthCheck } from './doctor-env-checks.js';
import {
  checkConfigFile, checkDaemonStatus, checkMemoryDatabase, checkApiKeys,
  checkMcpServers, checkMonograph, checkMonographFreshness, checkMonoesMemory,
  checkHelpersFresh, checkMonoesIntegration, checkGuidanceGates, checkGitignoreCoverage,
} from './doctor-project-checks.js';

function formatCheck(check: HealthCheck): string {
  const icon = check.status === 'pass' ? output.success('✓') :
               check.status === 'warn' ? output.warning('⚠') :
               output.error('✗');
  return `${icon} ${check.name}: ${check.message}`;
}

export const doctorCommand: Command = {
  name: 'doctor',
  description: 'System diagnostics and health checks',
  options: [
    { name: 'fix', short: 'f', description: 'Show fix commands for issues', type: 'boolean', default: false },
    { name: 'install', short: 'i', description: 'Auto-install missing dependencies (Claude Code CLI)', type: 'boolean', default: false },
    {
      name: 'component', short: 'c',
      description: 'Check specific component (version, node, npm, config, daemon, memory, api, git, mcp, claude, disk, typescript, monograph, graph-freshness, memory-pkg, helpers, monoes, gates, gitignore)',
      type: 'string',
    },
    { name: 'verbose', short: 'v', description: 'Verbose output', type: 'boolean', default: false },
  ],
  examples: [
    { command: 'monomind doctor', description: 'Run full health check' },
    { command: 'monomind doctor --fix', description: 'Show fixes for issues' },
    { command: 'monomind doctor --install', description: 'Auto-install missing dependencies' },
    { command: 'monomind doctor -c version', description: 'Check for stale npx cache' },
    { command: 'monomind doctor -c claude', description: 'Check Claude Code CLI only' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const showFix = ctx.flags.fix as boolean;
    const autoInstall = ctx.flags.install as boolean;
    const component = ctx.flags.component as string;

    output.writeln();
    output.writeln(output.bold('MonoMind Doctor'));
    output.writeln(output.dim('System diagnostics and health check'));
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const allChecks: (() => Promise<HealthCheck>)[] = [
      checkVersionFreshness, checkNodeVersion, checkNpmVersion, checkClaudeCode,
      checkGit, checkGitRepo, checkConfigFile, checkDaemonStatus, checkMemoryDatabase,
      checkApiKeys, checkMcpServers, checkDiskSpace, checkBuildTools,
      checkMonograph, checkMonographFreshness, checkMonoesMemory,
      checkHelpersFresh, checkMonoesIntegration, checkGuidanceGates, checkGitignoreCoverage,
    ];

    const componentMap: Record<string, () => Promise<HealthCheck>> = {
      version: checkVersionFreshness, freshness: checkVersionFreshness,
      node: checkNodeVersion, npm: checkNpmVersion, claude: checkClaudeCode,
      config: checkConfigFile, daemon: checkDaemonStatus, memory: checkMemoryDatabase,
      api: checkApiKeys, git: checkGit, mcp: checkMcpServers, disk: checkDiskSpace,
      typescript: checkBuildTools, monograph: checkMonograph,
      'graph-freshness': checkMonographFreshness, 'memory-pkg': checkMonoesMemory,
      helpers: checkHelpersFresh, monoes: checkMonoesIntegration,
      gates: checkGuidanceGates, gitignore: checkGitignoreCoverage,
    };

    const checksToRun = (component && componentMap[component]) ? [componentMap[component]] : allChecks;
    const results: HealthCheck[] = [];
    const fixes: string[] = [];

    const spinner = output.createSpinner({ text: 'Running health checks in parallel...', spinner: 'dots' });
    spinner.start();

    try {
      const settled = await Promise.allSettled(checksToRun.map(check => check()));
      spinner.stop();

      for (const result of settled) {
        if (result.status === 'fulfilled') {
          const r = result.value;
          results.push(r);
          output.writeln(formatCheck(r));
          if (r.fix && r.status === 'fail') output.writeln(output.dim(`  Fix: ${r.fix}`));
          else if (r.fix && r.status === 'warn') output.writeln(output.dim(`  Hint: ${r.fix}`));
          if (r.fix && (r.status === 'fail' || r.status === 'warn')) fixes.push(`${r.name}: ${r.fix}`);
        } else {
          const err: HealthCheck = { name: 'Check', status: 'fail', message: result.reason?.message || 'Unknown error' };
          results.push(err);
          output.writeln(formatCheck(err));
        }
      }
    } catch {
      spinner.stop();
      output.writeln(output.error('Failed to run health checks'));
    }

    if (autoInstall) {
      const claudeResult = results.find(r => r.name === 'Claude Code CLI');
      if (claudeResult && claudeResult.status !== 'pass') {
        if (await installClaudeCode()) {
          const newCheck = await checkClaudeCode();
          const idx = results.findIndex(r => r.name === 'Claude Code CLI');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex(f => f.startsWith('Claude Code CLI:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    const passed = results.filter(r => r.status === 'pass').length;
    const warnings = results.filter(r => r.status === 'warn').length;
    const failed = results.filter(r => r.status === 'fail').length;

    output.writeln();
    output.writeln(output.dim('─'.repeat(50)));
    output.writeln();

    const summaryParts = [
      output.success(`${passed} passed`),
      warnings > 0 ? output.warning(`${warnings} warnings`) : null,
      failed > 0 ? output.error(`${failed} failed`) : null,
    ].filter(Boolean);
    output.writeln(`Summary: ${summaryParts.join(', ')}`);

    if (showFix && fixes.length > 0) {
      output.writeln();
      output.writeln(output.bold('Suggested Fixes:'));
      output.writeln();
      for (const fix of fixes) output.writeln(output.dim(`  ${fix}`));
    } else if (!showFix) {
      const warnFixes = results.filter(r => r.status === 'warn' && r.fix).length;
      if (warnFixes > 0) output.writeln(output.dim(`\nRun with --fix to see ${warnFixes} suggested fix${warnFixes > 1 ? 'es' : ''} for warnings`));
    }

    if (failed > 0) {
      output.writeln();
      output.writeln(output.error('Some checks failed. Please address the issues above.'));
      return { success: false, exitCode: 1, data: { passed, warnings, failed, results } };
    } else if (warnings > 0) {
      output.writeln();
      output.writeln(output.warning('All checks passed with some warnings.'));
      return { success: true, data: { passed, warnings, failed, results } };
    }
    output.writeln();
    output.writeln(output.success('All checks passed! System is healthy.'));
    return { success: true, data: { passed, warnings, failed, results } };
  },
};

export default doctorCommand;
