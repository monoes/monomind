/**
 * CLI Doctor Command
 * System diagnostics, dependency checks, config validation
 *
 * github.com/monoes/monomind
 */

import * as path from 'node:path';
import { output } from '../output.js';
import { runPlatformsDoctor } from '../platform-adapters/operations.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { checkCatalog } from './doctor-catalog-checks.js';
import { checkDecisionModel, checkDecisionModelIfConfigured } from './doctor-decision-checks.js';
import type { HealthCheck } from './doctor-env-checks.js';
import {
  checkBuildTools,
  checkClaudeCode,
  checkCrashReporting,
  checkDiskSpace,
  checkGit,
  checkGitRepo,
  checkNodeVersion,
  checkNpmVersion,
  checkVersionFreshness,
  installClaudeCode,
} from './doctor-env-checks.js';
import { downgradeFreshInstallWarnings } from './doctor-fresh-install.js';
import { checkHookMonograph } from './doctor-hook-monograph-checks.js';
import { checkHookSettings } from './doctor-hook-settings-checks.js';
import { type DoctorResult, doctorJsonPayload } from './doctor-json.js';
import {
  DOCTOR_MODE_OPTIONS,
  doctorError,
  modeLabel,
  resolveDoctorMode,
  skippedCheck,
} from './doctor-mode.js';
import {
  checkMonoesTokenExposure,
  checkMonoesTools,
  fixMonoesTools,
} from './doctor-monoes-checks.js';
import { checkNativeBindings } from './doctor-native-checks.js';
import { checkPick } from './doctor-pick-checks.js';
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
  checkProjectRoot,
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
          : check.status === 'skipped'
            ? output.dim('-')
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
        'Check specific component (version, node, npm, config, project-root, memory, api, git, mcp, claude, disk, native, typescript, monograph, graph-freshness, hook-monograph, memory-pkg, helpers, monoes, gates, hook-settings, gitignore, registry, memory-proficiency, monoes-tools, monoes-token, dashboard-token, metrics-freshness, security-audit, documents, platforms, crash-reporting, jev, catalog, pick)',
      type: 'string',
    },
    { name: 'verbose', short: 'v', description: 'Verbose output', type: 'boolean', default: false },
    {
      name: 'json',
      description:
        'Print the results as JSON on stdout (human text goes to stderr) — for programs such as mono-agent',
      type: 'boolean',
      default: false,
    },
    ...DOCTOR_MODE_OPTIONS,
  ],
  examples: [
    { command: 'monomind doctor', description: 'Run full health check' },
    { command: 'monomind doctor --fix', description: 'Show fixes for issues' },
    {
      command: 'monomind doctor --json',
      description: 'Machine-readable results (add --fix to apply fixes)',
    },
    {
      command: 'monomind doctor --json --offline',
      description: 'Health check that changes no file and uses no network',
    },
    { command: 'monomind doctor --install', description: 'Auto-install missing dependencies' },
    { command: 'monomind doctor -c version', description: 'Check for stale npx cache' },
    { command: 'monomind doctor -c claude', description: 'Check Claude Code CLI only' },
    {
      command: 'monomind doctor -c mcp',
      description: 'Start the configured MCP server and verify it answers initialize',
    },
    {
      command: 'monomind doctor -c pick',
      description:
        'Agent/skill picking: registry, skill index, decision model, eval score, adherence (not in the default run)',
    },
    {
      command: 'monomind doctor -c monoes-tools --install',
      description:
        'Check/fix monotask, mono-agent, mono-clip install issues (opt-in, not in the default run)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    if (!(ctx.flags.json || ctx.flags.format === 'json')) return runDoctor(ctx, false);
    // stdout carries only the JSON payload; everything a check or fix
    // prints goes to stderr meanwhile.
    const previous = output.setOutputStream(process.stderr);
    let result: CommandResult;
    try {
      result = await runDoctor(ctx, true);
    } finally {
      output.setOutputStream(previous);
    }
    output.printJson(doctorJsonPayload(ctx, result));
    return result;
  },
};

async function runDoctor(ctx: CommandContext, json: boolean): Promise<CommandResult> {
  const showFix = ctx.flags.fix as boolean;
  const autoInstall = ctx.flags.install as boolean;
  const component = ctx.flags.component as string;
  const mode = resolveDoctorMode(ctx.flags);
  if (mode.error) return doctorError(mode.error);
  const checkPlatforms = async (): Promise<HealthCheck> => {
    const reports = await runPlatformsDoctor({ path: ctx.cwd, scope: 'project' });
    const lines = reports.map((report) => {
      const state = report.legacy.findings.length
        ? `legacy (${report.legacy.findings.join(', ')})`
        : report.artifacts.some((artifact) => artifact.state === 'managed')
          ? 'managed'
          : 'not installed';
      return `${report.platform}: ${state}; run monomind platforms doctor --platform ${report.platform}`;
    });
    return { name: 'Platform Adapters', status: 'info', message: lines.join('\n') };
  };

  output.writeln();
  output.writeln(output.bold('MonoMind Doctor'));
  output.writeln(output.dim('System diagnostics and health check'));
  output.writeln(output.dim('─'.repeat(50)));
  if (modeLabel(mode)) output.writeln(output.dim(modeLabel(mode)));
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

  type CheckFn = () => Promise<HealthCheck | HealthCheck[]>;
  // Each check is paired with its component id (the `-c` name), which is
  // also how `--json` identifies results.
  const alwaysOnChecks: [string, CheckFn][] = [
    ['version', () => checkVersionFreshness({ readOnly: mode.readOnly })],
    ['node', checkNodeVersion],
    ['npm', checkNpmVersion],
    ['claude', checkClaudeCode],
    ['config', checkConfigFile],
    ['project-root', checkProjectRoot],
    ['memory', checkMemoryDatabase],
    ['disk', checkDiskSpace],
    ['monograph', checkMonograph],
    ['memory-pkg', checkMonoesMemory],
    ['helpers', checkHelpersFresh],
    ['monoes', checkMonoesIntegration],
    ['gates', checkGuidanceGates],
    ['hook-settings', () => checkHookSettings(ctx.cwd || process.cwd())],
    ['registry', () => checkAgentRegistry({ readOnly: mode.readOnly })],
    ['git', checkGit],
    ['api', checkApiKeys],
    ['memory-proficiency', checkMemoryProficiency],
    ['metrics-freshness', checkMetricsFreshness],
    ['security-audit', checkSecurityAuditFindings],
    ['second-brain', checkSecondBrainModel],
    ['kg', checkMemoryKnowledgeGraph],
    ['appledouble', checkAppleDoubleSidecars],
    ['documents', checkDocumentExtractors],
    // Config-only (no network), and only when Jev env is set: an unconfigured
    // full doctor run prints exactly what it printed before. `-c jev` probes.
    ['jev', () => checkDecisionModelIfConfigured()],
    // i-055-cli's consent gate applies to every project regardless of
    // whether it has code (a document/media-only project can still crash
    // and needs to know its crash-reporting state) — alwaysOnChecks, not
    // codeOnlyChecks.
    ['crash-reporting', checkCrashReporting],
  ];
  const codeOnlyChecks: [string, CheckFn][] = [
    ['git-repo', checkGitRepo],
    ['native', checkNativeBindings],
    ['mcp', checkMcpServers],
    ['typescript', checkBuildTools],
    ['graph-freshness', checkMonographFreshness],
    ['hook-monograph', () => checkHookMonograph(process.cwd(), { readOnly: mode.readOnly })],
    ['gitignore', () => checkGitignoreCoverage(ctx.cwd || process.cwd())],
    ['monoes-token', checkMonoesTokenExposure],
    ['platforms', checkPlatforms],
  ];

  const allChecks: [string, CheckFn][] = isCodeProject
    ? [...alwaysOnChecks, ...codeOnlyChecks]
    : alwaysOnChecks;

  const componentMap: Record<string, () => Promise<HealthCheck | HealthCheck[]>> = {
    version: () => checkVersionFreshness({ readOnly: mode.readOnly }),
    freshness: () => checkVersionFreshness({ readOnly: mode.readOnly }),
    node: checkNodeVersion,
    npm: checkNpmVersion,
    claude: checkClaudeCode,
    config: checkConfigFile,
    'project-root': checkProjectRoot,
    memory: checkMemoryDatabase,
    api: checkApiKeys,
    git: checkGit,
    // i-312: asking for the MCP check by name means "is my server actually
    // usable", so this one starts it and speaks `initialize`. The full
    // `doctor` run keeps the registry-only check — a start-up probe there
    // would spawn a subprocess (and, with an npx entry, possibly a package
    // download) on every invocation, interactive and CI alike.
    mcp: () => checkMcpServers({ probe: true }),
    disk: checkDiskSpace,
    'second-brain': checkSecondBrainModel,
    kg: checkMemoryKnowledgeGraph,
    appledouble: checkAppleDoubleSidecars,
    sidecars: checkAppleDoubleSidecars,
    typescript: checkBuildTools,
    monograph: checkMonograph,
    'graph-freshness': checkMonographFreshness,
    'hook-monograph': () => checkHookMonograph(process.cwd(), { readOnly: mode.readOnly }),
    native: checkNativeBindings,
    'native-modules': checkNativeBindings,
    'memory-pkg': checkMonoesMemory,
    helpers: checkHelpersFresh,
    monoes: checkMonoesIntegration,
    gates: checkGuidanceGates,
    'hook-settings': () => checkHookSettings(ctx.cwd || process.cwd()),
    gitignore: () => checkGitignoreCoverage(ctx.cwd || process.cwd()),
    registry: () => checkAgentRegistry({ readOnly: mode.readOnly }),
    'memory-proficiency': checkMemoryProficiency,
    'monoes-tools': checkMonoesTools,
    'monoes-token': checkMonoesTokenExposure,
    // i-052 commit 3: same function as 'monoes-token' — it now covers
    // both credentials (see checkMonoesTokenExposure's own doc comment)
    // and is already always-on, so this alias exists purely so a user
    // (or an incident writeup) can find the check by the name of the
    // credential that leaked, not just the one that motivated the
    // original i-066 check.
    'dashboard-token': checkMonoesTokenExposure,
    'metrics-freshness': checkMetricsFreshness,
    'security-audit': checkSecurityAuditFindings,
    documents: checkDocumentExtractors,
    'doc-extractors': checkDocumentExtractors,
    jev: () => checkDecisionModel({ probe: true }),
    decision: () => checkDecisionModel({ probe: true }),
    platforms: checkPlatforms,
    'crash-reporting': checkCrashReporting,
    catalog: () => checkCatalog(ctx.cwd || process.cwd()),
    // Opt-in: rebuilds stale indexes and scores the eval set, so it stays out
    // of the default run.
    pick: () => checkPick(ctx.cwd || process.cwd()),
  };

  if (component && !componentMap[component]) {
    output.writeln(output.error(`Unknown component: "${component}"`));
    output.writeln(`Valid components: ${Object.keys(componentMap).sort().join(', ')}`);
    return {
      success: false,
      exitCode: 1,
      data: {
        passed: 0,
        warnings: 0,
        failed: 1,
        results: [],
        error: `unknown component "${component}"`,
      },
    };
  }

  const checksToRun: [string, CheckFn][] = component
    ? [[component, componentMap[component]]]
    : allChecks;
  const results: DoctorResult[] = [];
  const fixOutcomes: { component: string; outcome: 'applied' | 'failed' }[] = [];
  const fixes: string[] = [];

  // Checks are run sequentially rather than via Promise.all/allSettled — several
  // of them shell out (git, npm, npx tsc, claude --version, etc.), and running
  // those concurrently was observed to race/fail intermittently. The checks are
  // individually fast, so sequential execution has no meaningful cost.
  const spinner = output.createSpinner({ text: 'Running health checks...', spinner: 'dots' });
  // The spinner writes to process.stdout directly; in JSON mode that
  // would corrupt the payload.
  if (!json) spinner.start();

  try {
    const settled: DoctorResult[] = [];
    for (const [id, check] of checksToRun) {
      try {
        const result = skippedCheck(id, mode, Boolean(component)) ?? (await check());
        for (const r of Array.isArray(result) ? result : [result])
          settled.push({ ...r, component: id });
      } catch (err) {
        settled.push({
          name: 'Check',
          status: 'fail',
          message: err instanceof Error ? err.message : 'Unknown error',
          component: id,
        });
      }
    }
    spinner.stop();

    // P2-14: expected warnings on a brand-new install read as info.
    if (!ctx.flags.verbose) downgradeFreshInstallWarnings(settled, ctx.cwd);

    for (const r of settled) {
      results.push(r);
      output.writeln(formatCheck(r));
      if (r.fix && r.status === 'fail') output.writeln(output.dim(`  Fix: ${r.fix}`));
      else if (r.fix && r.status === 'warn') output.writeln(output.dim(`  Hint: ${r.fix}`));
      if (r.fix && (r.status === 'fail' || r.status === 'warn')) fixes.push(`${r.name}: ${r.fix}`);
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
    const needsFix = (name: string) => results.some((r) => r.name === name && r.status !== 'pass');
    const applyFix = async (
      name: string,
      component: string,
      fix: () => Promise<boolean>,
      recheck: () => Promise<HealthCheck>,
    ) => {
      const fixed = await fix();
      fixOutcomes.push({ component, outcome: fixed ? 'applied' : 'failed' });
      if (!fixed) return;
      const newCheck = await recheck();
      const idx = results.findIndex((r) => r.name === name);
      if (idx !== -1) {
        results[idx] = { ...newCheck, component: results[idx].component };
        const fixIdx = fixes.findIndex((f) => f.startsWith(`${name}:`));
        if (fixIdx !== -1 && newCheck.status === 'pass') fixes.splice(fixIdx, 1);
      }
      output.writeln(formatCheck(newCheck));
    };

    if (autoInstall && needsFix('Claude Code CLI'))
      await applyFix('Claude Code CLI', 'claude', installClaudeCode, checkClaudeCode);
    if (needsFix('monoes Tools'))
      await applyFix('monoes Tools', 'monoes-tools', fixMonoesTools, checkMonoesTools);
    if (needsFix('Gitignore Coverage'))
      await applyFix(
        'Gitignore Coverage',
        'gitignore',
        () => fixGitignoreCoverage(ctx.cwd || process.cwd()),
        () => checkGitignoreCoverage(ctx.cwd || process.cwd()),
      );
    if (needsFix('AppleDouble Sidecars'))
      await applyFix(
        'AppleDouble Sidecars',
        'appledouble',
        async () => fixAppleDoubleSidecars(process.cwd()) > 0,
        checkAppleDoubleSidecars,
      );
    if (needsFix('Helper Files'))
      await applyFix('Helper Files', 'helpers', fixStaleHelpers, checkHelpersFresh);
  }

  const passed = results.filter((r) => r.status === 'pass').length;
  const warnings = results.filter((r) => r.status === 'warn').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  output.writeln();
  output.writeln(output.dim('─'.repeat(50)));
  output.writeln();

  const summaryParts = [
    output.success(`${passed} passed`),
    warnings > 0 ? output.warning(`${warnings} warnings`) : null,
    failed > 0 ? output.error(`${failed} failed`) : null,
    skipped > 0 ? output.dim(`${skipped} skipped`) : null,
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
    return {
      success: false,
      exitCode: 1,
      data: { passed, warnings, failed, results, fixes: fixOutcomes },
    };
  } else if (warnings > 0) {
    output.writeln();
    output.writeln(output.warning('All checks passed with some warnings.'));
    return { success: true, data: { passed, warnings, failed, results, fixes: fixOutcomes } };
  }
  output.writeln();
  output.writeln(output.success('All checks passed! System is healthy.'));
  return { success: true, data: { passed, warnings, failed, results, fixes: fixOutcomes } };
}

export default doctorCommand;
