/**
 * CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * github.com/monoes/monomind
 */

import * as path from 'node:path';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import type { HealthCheck } from './doctor-env-checks.js';
import {
  checkBuildTools,
  checkClaudeCode,
  checkDiskSpace,
  checkGit,
  checkGitRepo,
  checkNodeVersion,
  checkNpmVersion,
  checkVersionFreshness,
  installClaudeCode,
} from './doctor-env-checks.js';
import { checkMonoesTools, fixMonoesTools } from './doctor-monoes-checks.js';
import {
  checkAgentRegistry,
  checkApiKeys,
  checkAppleDoubleSidecars,
  checkConfigFile,
  checkDocumentExtractors,
  checkGitignoreCoverage,
  checkGuidanceGates,
  checkHelpersFresh,
  checkMcpServers,
  checkMemoryDatabase,
  checkMemoryKnowledgeGraph,
  checkMemoryProficiency,
  checkMetricsFreshness,
  checkMonoesIntegration,
  checkMonoesMemory,
  checkMonograph,
  checkMonographFreshness,
  checkSecondBrainModel,
  checkSecurityAuditFindings,
  fixAppleDoubleSidecars,
  fixGitignoreCoverage,
  fixStaleHelpers,
} from './doctor-project-checks.js';

function formatCheck(check: HealthCheck): string {
  const icon =
    check.status === 'pass'
      ? output.success('✓')
      : check.status === 'warn'
        ? output.warning('⚠')
        : check.status === 'info'
          ? output.dim('ℹ')
          : output.error('✗');
  return `${icon} ${check.name}: ${check.message}`;
}

export const doctorCommand: Command = {
  name: 'doctor',
  description: 'System diagnostics and health checks',
  options: [
    {
      name: 'fix',
      short: 'f',
      description:
        'Apply local fixes (helper files, monoes tool shims, .gitignore entries) and show fix commands for the rest',
      type: 'boolean',
      default: false,
    },
    {
      name: 'install',
      short: 'i',
      description: 'Auto-install missing dependencies (Claude Code CLI)',
      type: 'boolean',
      default: false,
    },
    {
      name: 'component',
      short: 'c',
      description:
        'Check specific component (version, node, npm, config, memory, api, git, mcp, claude, disk, typescript, monograph, graph-freshness, memory-pkg, helpers, monoes, gates, gitignore, registry, memory-proficiency, monoes-tools, metrics-freshness, security-audit, documents)',
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
    {
      command: 'monomind doctor -c monoes-tools --install',
      description:
        'Check/fix monotask, mono-agent, mono-clip install issues (opt-in, not in the default run)',
    },
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

    // Capability-aware scoping: skip code-specific checks in non-code directories
    // (e.g. document/media/data-only projects created via `monomind init`).
    let isCodeProject = true;
    try {
      const { loadFingerprint } = await import('../capabilities/index.js');
      const monomindDir = path.join(process.cwd(), '.monomind');
      const fingerprint = await loadFingerprint(monomindDir);
      isCodeProject = !fingerprint || fingerprint.capabilities.code.confidence >= 0.1;
    } catch {
      // Fingerprint unavailable — default to treating this as a code project
      // so existing behavior is unaffected when the capabilities module can't load.
      isCodeProject = true;
    }

    const alwaysOnChecks: (() => Promise<HealthCheck | HealthCheck[]>)[] = [
      checkVersionFreshness,
      checkNodeVersion,
      checkNpmVersion,
      checkClaudeCode,
      checkConfigFile,
      checkMemoryDatabase,
      checkDiskSpace,
      checkMonograph,
      checkMonoesMemory,
      checkHelpersFresh,
      checkMonoesIntegration,
      checkGuidanceGates,
      checkAgentRegistry,
      checkGit,
      checkApiKeys,
      checkMemoryProficiency,
      checkMetricsFreshness,
      checkSecurityAuditFindings,
      checkSecondBrainModel,
      checkMemoryKnowledgeGraph,
      checkAppleDoubleSidecars,
      checkDocumentExtractors,
    ];
    const codeOnlyChecks: (() => Promise<HealthCheck | HealthCheck[]>)[] = [
      checkGitRepo,
      checkMcpServers,
      checkBuildTools,
      checkMonographFreshness,
      checkGitignoreCoverage,
    ];

    const allChecks: (() => Promise<HealthCheck | HealthCheck[]>)[] = isCodeProject
      ? [...alwaysOnChecks, ...codeOnlyChecks]
      : alwaysOnChecks;

    const componentMap: Record<string, () => Promise<HealthCheck | HealthCheck[]>> = {
      version: checkVersionFreshness,
      freshness: checkVersionFreshness,
      node: checkNodeVersion,
      npm: checkNpmVersion,
      claude: checkClaudeCode,
      config: checkConfigFile,
      memory: checkMemoryDatabase,
      api: checkApiKeys,
      git: checkGit,
      mcp: checkMcpServers,
      disk: checkDiskSpace,
      'second-brain': checkSecondBrainModel,
      kg: checkMemoryKnowledgeGraph,
      appledouble: checkAppleDoubleSidecars,
      sidecars: checkAppleDoubleSidecars,
      typescript: checkBuildTools,
      monograph: checkMonograph,
      'graph-freshness': checkMonographFreshness,
      'memory-pkg': checkMonoesMemory,
      helpers: checkHelpersFresh,
      monoes: checkMonoesIntegration,
      gates: checkGuidanceGates,
      gitignore: checkGitignoreCoverage,
      registry: checkAgentRegistry,
      'memory-proficiency': checkMemoryProficiency,
      'monoes-tools': checkMonoesTools,
      'metrics-freshness': checkMetricsFreshness,
      'security-audit': checkSecurityAuditFindings,
      documents: checkDocumentExtractors,
      'doc-extractors': checkDocumentExtractors,
    };

    if (component && !componentMap[component]) {
      output.writeln(output.error(`Unknown component: "${component}"`));
      output.writeln(`Valid components: ${Object.keys(componentMap).sort().join(', ')}`);
      return {
        success: false,
        exitCode: 1,
        data: { passed: 0, warnings: 0, failed: 1, results: [] },
      };
    }

    const checksToRun = component ? [componentMap[component]] : allChecks;
    const results: HealthCheck[] = [];
    const fixes: string[] = [];

    // Checks are run sequentially rather than via Promise.all/allSettled — several
    // of them shell out (git, npm, npx tsc, claude --version, etc.), and running
    // those concurrently was observed to race/fail intermittently. The checks are
    // individually fast, so sequential execution has no meaningful cost.
    const spinner = output.createSpinner({ text: 'Running health checks...', spinner: 'dots' });
    spinner.start();

    try {
      const settled: HealthCheck[] = [];
      for (const check of checksToRun) {
        try {
          const result = await check();
          if (Array.isArray(result)) settled.push(...result);
          else settled.push(result);
        } catch (err) {
          settled.push({
            name: 'Check',
            status: 'fail',
            message: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }
      spinner.stop();

      // P2-14: Quiet the fresh-install doctor. On a brand-new install, 9+ checks
      // report warnings that are actually expected states. Detect fresh install
      // (`.monomind/` dir < 5 min old) and downgrade expected warnings to info
      // unless --verbose is set.
      const verbose = ctx.flags.verbose as boolean;
      if (!verbose) {
        const monomindDir = path.join(ctx.cwd, '.monomind');
        let isFreshInstall = false;
        try {
          const { statSync } = await import('node:fs');
          const stat = statSync(monomindDir);
          isFreshInstall = Date.now() - stat.birthtimeMs < 5 * 60 * 1000; // < 5 min old
        } catch {
          /* dir doesn't exist — not our project */
        }
        if (isFreshInstall) {
          const FRESH_EXPECTED = new Set([
            'Memory Database',
            'Memory Knowledge Graph',
            'Second Brain Model',
            'Graph freshness',
            'MCP Servers',
            'Worker Metrics',
            'Security Audit',
            'Helper Files',
            'AppleDouble Sidecars',
            'Monoes Memory',
          ]);
          for (let i = 0; i < settled.length; i++) {
            if (settled[i].status === 'warn' && FRESH_EXPECTED.has(settled[i].name)) {
              settled[i] = {
                ...settled[i],
                status: 'info' as const,
                message: `${settled[i].message} (expected on fresh install — run with --verbose for details)`,
              };
            }
          }
        }
      }

      for (const r of settled) {
        results.push(r);
        output.writeln(formatCheck(r));
        if (r.fix && r.status === 'fail') output.writeln(output.dim(`  Fix: ${r.fix}`));
        else if (r.fix && r.status === 'warn') output.writeln(output.dim(`  Hint: ${r.fix}`));
        if (r.fix && (r.status === 'fail' || r.status === 'warn'))
          fixes.push(`${r.name}: ${r.fix}`);
      }
    } catch {
      spinner.stop();
      output.writeln(output.error('Failed to run health checks'));
    }

    // `--fix` applies the lightweight, local, no-network fixes (helper files,
    // monoes CLI tool shims) — its description says "show fix commands" but
    // silently doing nothing for these two beyond printing a hint is a worse
    // outcome than just fixing them, and copying a bundled file locally is
    // nothing like installing a package. `--install` additionally covers the
    // Claude Code CLI, which is a real install (network fetch + binary setup)
    // — kept opt-in separately so `--fix` alone never triggers that.
    if (autoInstall || showFix) {
      const claudeResult = results.find((r) => r.name === 'Claude Code CLI');
      if (autoInstall && claudeResult && claudeResult.status !== 'pass') {
        if (await installClaudeCode()) {
          const newCheck = await checkClaudeCode();
          const idx = results.findIndex((r) => r.name === 'Claude Code CLI');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex((f) => f.startsWith('Claude Code CLI:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }

      const monoesToolsResult = results.find((r) => r.name === 'monoes Tools');
      if (monoesToolsResult && monoesToolsResult.status !== 'pass') {
        if (await fixMonoesTools()) {
          const newCheck = await checkMonoesTools();
          const idx = results.findIndex((r) => r.name === 'monoes Tools');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex((f) => f.startsWith('monoes Tools:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }

      const gitignoreResult = results.find((r) => r.name === 'Gitignore Coverage');
      if (gitignoreResult && gitignoreResult.status !== 'pass') {
        if (await fixGitignoreCoverage()) {
          const newCheck = await checkGitignoreCoverage();
          const idx = results.findIndex((r) => r.name === 'Gitignore Coverage');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex((f) => f.startsWith('Gitignore Coverage:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }

      const sidecarResult = results.find((r) => r.name === 'AppleDouble Sidecars');
      if (sidecarResult && sidecarResult.status !== 'pass') {
        const removed = fixAppleDoubleSidecars(process.cwd());
        if (removed > 0) {
          const newCheck = await checkAppleDoubleSidecars();
          const idx = results.findIndex((r) => r.name === 'AppleDouble Sidecars');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex((f) => f.startsWith('AppleDouble Sidecars:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }

      const helpersResult = results.find((r) => r.name === 'Helper Files');
      if (helpersResult && helpersResult.status !== 'pass') {
        if (await fixStaleHelpers()) {
          const newCheck = await checkHelpersFresh();
          const idx = results.findIndex((r) => r.name === 'Helper Files');
          if (idx !== -1) {
            results[idx] = newCheck;
            const fixIdx = fixes.findIndex((f) => f.startsWith('Helper Files:'));
            if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
          }
          output.writeln(formatCheck(newCheck));
        }
      }
    }

    const passed = results.filter((r) => r.status === 'pass').length;
    const warnings = results.filter((r) => r.status === 'warn').length;
    const failed = results.filter((r) => r.status === 'fail').length;

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
      const warnFixes = results.filter((r) => r.status === 'warn' && r.fix).length;
      if (warnFixes > 0)
        output.writeln(
          output.dim(
            `\nRun with --fix to see ${warnFixes} suggested fix${warnFixes > 1 ? 'es' : ''} for warnings`,
          ),
        );
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
