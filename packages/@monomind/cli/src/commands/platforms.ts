/** Evidence-gated platform adapter lifecycle commands. */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { output } from '../output.js';
import { renderCompatibilityMatrix } from '../platform-adapters/docs.js';
import {
  installPlatform,
  migrateLegacyInstall,
  planInstall,
  runPlatformsDoctor,
  uninstallPlatform,
  upgradePlatforms,
} from '../platform-adapters/operations.js';
import {
  PLATFORM_IDS,
  PLATFORM_REGISTRY,
  resolvePlatformId,
} from '../platform-adapters/registry.js';
import type { InstallScope, MutationRequest, PlatformId } from '../platform-adapters/types.js';
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
  output.error(reason instanceof Error ? reason.message : String(reason));
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
    result.changed.forEach((path) => output.success(`Updated ${path}`));
    result.skipped.forEach((path) => output.info(`Skipped ${path}`));
    result.diagnostics.forEach((diagnostic) => output.info(diagnostic));
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
        output.info(`Plan: ${plan.intents.length} artifact(s)`);
        plan.diagnostics.forEach((diagnostic) => output.info(diagnostic));
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
    else
      reports.forEach((report) => {
        const state =
          report.artifacts.map((artifact) => artifact.state).join(', ') || 'no declared artifacts';
        output.info(`${report.platform}: ${state}`);
        report.diagnostics.forEach((diagnostic) => output.info(diagnostic));
      });
    return { success: true, data: reports };
  } catch (reason) {
    return resultError(reason);
  }
}

async function handleSetup(ctx: CommandContext): Promise<CommandResult> {
  const targets = requireTargets(ctx);
  if (!Array.isArray(targets)) return targets;
  output.info(
    'platforms setup is deprecated and no longer writes SessionStart hooks or global plugins.',
  );
  output.info('Use platforms doctor, then platforms install --scope user --yes.');
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
    output.error(
      'Platform compatibility documentation is stale; regenerate it from the platform registry.',
    );
    return { success: false, exitCode: 1 };
  }
  output.success('Platform compatibility documentation is current.');
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
