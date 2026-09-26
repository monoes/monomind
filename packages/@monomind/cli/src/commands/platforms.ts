/** Evidence-gated platform adapter lifecycle commands. */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { output } from '../output.js';
import { renderCompatibilityMatrix } from '../platform-adapters/docs.js';
import { LEGACY_SURFACE_INVENTORY, type LegacySurface } from '../platform-adapters/migration.js';
import {
  installPlatform,
  migrateLegacyInstall,
  planInstall,
  uninstallPlatform,
  upgradePlatforms,
} from '../platform-adapters/operations.js';
import { runPlatformsDoctor } from '../platform-adapters/platform-doctor.js';
import {
  PLATFORM_IDS,
  PLATFORM_REGISTRY,
  resolvePlatformId,
} from '../platform-adapters/registry.js';
import type {
  InstallScope,
  MutationRequest,
  PlatformDoctorReport,
  PlatformId,
} from '../platform-adapters/types.js';
import type { Command, CommandContext, CommandOption, CommandResult } from '../types.js';

export const SUPPORTED_PLATFORMS = PLATFORM_IDS;
export type Platform = PlatformId;

/**
 * Compatibility helper retained for callers that package portable skill roots.
 * Adapter operations only materialize the router; distribution remains
 * manifest-owned and never installs prompt-injection hooks.
 */
export function installMastermindSkills(targetDir: string, sourceDir: string): string[] {
  const written: string[] = [];
  for (const source of readdirSync(sourceDir).filter(
    (file) => file.endsWith('.md') && !file.startsWith('_'),
  )) {
    const name = basename(source, '.md');
    const skillName = name === 'master' ? 'mastermind' : `mastermind-${name}`;
    const destination = join(targetDir, skillName, 'SKILL.md');
    const content =
      '---\nname: ' +
      skillName +
      '\ndescription: "Mastermind ' +
      name +
      ' workflow."\n---\n\n' +
      readFileSync(join(sourceDir, source), 'utf8');
    const existing = existsSync(destination) ? readFileSync(destination, 'utf8') : '';
    if (existing !== content) {
      mkdirSync(join(targetDir, skillName), { recursive: true });
      writeFileSync(destination, content, 'utf8');
      written.push(destination);
    }
  }
  return written;
}

function scopeFrom(ctx: CommandContext): InstallScope {
  return ctx.flags.scope === 'user' ? 'user' : 'project';
}

function targetFrom(ctx: CommandContext): PlatformId | undefined {
  const raw = ctx.flags.platform;
  return typeof raw === 'string' ? resolvePlatformId(raw) : undefined;
}

function targetsFrom(ctx: CommandContext): PlatformId[] | undefined {
  if (ctx.flags.all === true) return [...PLATFORM_IDS];
  const target = targetFrom(ctx);
  return target ? [target] : undefined;
}

function mutationRequest(ctx: CommandContext, platform?: PlatformId): MutationRequest {
  return {
    platform,
    all: ctx.flags.all === true,
    scope: scopeFrom(ctx),
    path: resolve(typeof ctx.flags.path === 'string' ? ctx.flags.path : ctx.cwd),
    yes: ctx.flags.yes === true,
    dryRun: ctx.flags['dry-run'] === true,
    enableHooks: ctx.flags['enable-hooks'] === true,
    enableBlockingHooks: ctx.flags['enable-blocking-hooks'] === true,
    removeLegacy: ctx.flags['remove-legacy'] === true,
  };
}

function resultError(reason: unknown): CommandResult {
  output.printError(reason instanceof Error ? reason.message : String(reason));
  return { success: false, exitCode: 1 };
}

function printResults(
  results: readonly {
    changed: readonly string[];
    skipped: readonly string[];
    diagnostics: readonly string[];
  }[],
): void {
  for (const result of results) {
    result.changed.forEach((path) => output.printSuccess(`Updated ${path}`));
    result.skipped.forEach((path) => output.printInfo(`Skipped ${path}`));
    result.diagnostics.forEach((diagnostic) => output.printInfo(diagnostic));
  }
}

function requireTargets(ctx: CommandContext): PlatformId[] | CommandResult {
  const targets = targetsFrom(ctx);
  if (targets) return targets;
  return resultError(
    typeof ctx.flags.platform === 'string'
      ? `Unknown platform: ${ctx.flags.platform}`
      : 'Specify --platform <id|alias> or --all',
  );
}

async function handlePlan(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  try {
    const plans = await Promise.all(
      targets.map((platform) => planInstall({ ...mutationRequest(ctx, platform), platform })),
    );
    if (ctx.flags.json === true) output.printJson(plans);
    else
      plans.forEach((plan) => {
        output.printInfo(`Plan: ${plan.intents.length} artifact(s)`);
        plan.diagnostics.forEach((diagnostic) => output.printInfo(diagnostic));
      });
    return { success: true, data: plans };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleInstall(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  try {
    const results =
      ctx.flags.all === true
        ? await upgradePlatforms(mutationRequest(ctx))
        : [await installPlatform({ ...mutationRequest(ctx, targets[0]), platform: targets[0]! })];
    printResults(results);
    return { success: true, data: results };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleUpgrade(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  try {
    const request = mutationRequest(ctx, ctx.flags.all === true ? undefined : targets[0]);
    const results = await upgradePlatforms(request);
    printResults(results);
    return { success: true, data: results };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleUninstall(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  try {
    const request = mutationRequest(ctx, ctx.flags.all === true ? undefined : targets[0]);
    const results = await uninstallPlatform(request);
    printResults(results);
    return { success: true, data: results };
  } catch (reason) {
    return resultError(reason);
  }
}

/** What a detected legacy surface is, in the user's terms, and how to clear it. */
const LEGACY_ACTION: Record<
  LegacySurface['action'],
  { meaning: string; fix: 'upgrade' | 'remove' }
> = {
  migrate: {
    meaning: 'unnamed pre-adapter block; upgrade rewrites it with the current named marker',
    fix: 'upgrade',
  },
  'remove-block': {
    meaning: 'Monomind block in a file the adapters no longer own',
    fix: 'upgrade',
  },
  'remove-entry': {
    meaning: 'Monomind entry in a config the adapters no longer own',
    fix: 'upgrade',
  },
  'remove-file': {
    meaning: 'file written by a pre-adapter install',
    fix: 'remove',
  },
};

function adapterState(report: PlatformDoctorReport): string {
  if (report.legacy.findings.length) return 'legacy';
  return report.artifacts.some((artifact) => artifact.state === 'managed')
    ? 'managed'
    : 'not installed';
}

function printLegacy(report: PlatformDoctorReport, scope: InstallScope): void {
  if (!report.legacy.findings.length) return;
  output.writeln(output.dim('  legacy surfaces detected:'));
  const fixes = new Set<string>();
  for (const id of report.legacy.findings) {
    const surface = LEGACY_SURFACE_INVENTORY.find((entry) => entry.id === id);
    const action = surface && LEGACY_ACTION[surface.action];
    output.writeln(
      `    ${id}  ${surface?.path ?? ''} — ${action?.meaning ?? 'pre-adapter artifact'}`,
    );
    if (action)
      fixes.add(
        action.fix === 'upgrade'
          ? `monomind platforms upgrade --platform ${report.platform} --scope ${scope}`
          : `monomind platforms uninstall --platform ${report.platform} --scope ${scope} --remove-legacy`,
      );
  }
  for (const fix of fixes) output.writeln(`    migrate with: ${fix}`);
}

function printDoctorReports(reports: readonly PlatformDoctorReport[], scope: InstallScope): void {
  output.writeln(output.bold(`Platform adapters (${scope} scope)`));
  for (const report of reports) {
    const adapter = PLATFORM_REGISTRY[report.platform];
    output.writeln();
    output.writeln(`${report.platform} (${adapter.displayName}): ${adapterState(report)}`);
    if (!report.artifacts.length) output.writeln('  artifacts: none declared');
    else output.writeln(output.dim('  artifacts:'));
    for (const artifact of report.artifacts)
      output.writeln(
        `    ${artifact.state.padEnd(8)} ${artifact.path}${artifact.reason ? ` (${artifact.reason})` : ''}`,
      );
    printLegacy(report, scope);
    if (report.diagnostics.length) {
      output.writeln(output.dim('  notes:'));
      report.diagnostics.forEach((diagnostic) => output.writeln(`    ${diagnostic}`));
    }
    const next =
      adapterState(report) === 'not installed'
        ? `install --platform ${report.platform}`
        : `upgrade --platform ${report.platform}`;
    output.writeln(`  next: monomind platforms ${next} --scope ${scope}`);
  }
  const legacy = reports.filter((report) => report.legacy.findings.length).length;
  output.writeln();
  output.writeln(
    `${reports.length} platform(s) inspected, ${legacy} with legacy surfaces. Legacy findings are warnings, not failures.`,
  );
}

async function handleDoctor(ctx: CommandContext): Promise<CommandResult> {
  const raw = typeof ctx.flags.platform === 'string' ? ctx.flags.platform : undefined;
  const platform = targetFrom(ctx);
  if (raw && !platform) return resultError(`Unknown platform: ${raw}`);
  try {
    const reports = await runPlatformsDoctor({
      platform,
      path: resolve(typeof ctx.flags.path === 'string' ? ctx.flags.path : ctx.cwd),
      scope: scopeFrom(ctx),
    });
    if (ctx.flags.json === true) output.printJson(reports);
    else printDoctorReports(reports, scopeFrom(ctx));
    // A legacy or missing artifact is a warning, not a command failure: doctor
    // reports state, it does not gate on it.
    return { success: true, data: reports };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleSetup(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  output.printInfo(
    'platforms setup is deprecated and no longer writes SessionStart hooks or global plugins.',
  );
  output.printInfo('Use platforms doctor, then platforms install --scope user --yes.');
  try {
    const result = await migrateLegacyInstall({
      ...mutationRequest(ctx, ctx.flags.all === true ? undefined : targets[0]),
      dryRun: true,
    });
    printResults(result);
    return { success: true, data: result };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleDocs(ctx: CommandContext): Promise<CommandResult> {
  const rendered = renderCompatibilityMatrix(PLATFORM_REGISTRY);
  if (ctx.flags.check !== true) {
    output.writeln(rendered);
    return { success: true, data: rendered };
  }
  const path = resolve(ctx.cwd, 'docs', 'platforms', 'compatibility.md');
  if (!existsSync(path) || readFileSync(path, 'utf8') !== rendered) {
    output.printError(
      'Platform compatibility documentation is stale; regenerate it from the platform registry.',
    );
    return { success: false, exitCode: 1 };
  }
  output.printSuccess('Platform compatibility documentation is current.');
  return { success: true };
}

const targetOptions: CommandOption[] = [
  { name: 'platform', description: 'Target platform id or legacy alias', type: 'string' },
  { name: 'all', description: 'Apply to all supported platforms', type: 'boolean', default: false },
  { name: 'path', description: 'Project root', type: 'string', default: '.' },
  {
    name: 'scope',
    description: 'Scope',
    type: 'string',
    choices: ['project', 'user'],
    default: 'project',
  },
];
const mutationOptions: CommandOption[] = [
  ...targetOptions,
  { name: 'yes', description: 'Authorize user-scope mutation', type: 'boolean', default: false },
  { name: 'dry-run', description: 'Plan without writing files', type: 'boolean', default: false },
];

export const platformsCommand: Command = {
  name: 'platforms',
  description: 'Plan and apply evidence-gated Monomind platform integrations',
  subcommands: [
    {
      name: 'plan',
      description: 'Render a read-only adapter plan',
      options: [
        ...targetOptions,
        { name: 'json', description: 'Print JSON', type: 'boolean', default: false },
      ],
      action: handlePlan,
    },
    {
      name: 'install',
      description: 'Apply a platform plan',
      options: [
        ...mutationOptions,
        {
          name: 'enable-hooks',
          description: 'Opt in to deterministic hooks',
          type: 'boolean',
          default: false,
        },
        {
          name: 'enable-blocking-hooks',
          description: 'Permit blocking hook decisions',
          type: 'boolean',
          default: false,
        },
      ],
      action: handleInstall,
    },
    {
      name: 'upgrade',
      description: 'Reapply managed platform artifacts',
      options: mutationOptions,
      action: handleUpgrade,
    },
    {
      name: 'uninstall',
      description: 'Remove only Monomind-owned artifacts',
      options: [
        ...mutationOptions,
        {
          name: 'remove-legacy',
          description: 'Remove marker-verified legacy artifacts',
          type: 'boolean',
          default: false,
        },
      ],
      action: handleUninstall,
    },
    {
      name: 'doctor',
      description: 'Inspect platform state without writes',
      options: [
        ...targetOptions,
        { name: 'json', description: 'Print JSON', type: 'boolean', default: false },
      ],
      action: handleDoctor,
    },
    {
      name: 'setup',
      description: 'Deprecated legacy detection shim',
      options: targetOptions,
      action: handleSetup,
    },
    {
      name: 'docs',
      description: 'Render or verify generated platform compatibility documentation',
      options: [
        { name: 'check', description: 'Fail when the checked-in matrix is stale', type: 'boolean' },
      ],
      action: handleDocs,
    },
  ],
};
