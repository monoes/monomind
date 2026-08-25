/** Platform projections for the neutral opt-in hook contract. */

import { renderNeutralHookBridge } from '../hook-bridge.js';
import type { ArtifactIntent, InstallScope, PlatformAdapter } from '../types.js';

export type HookTimeoutUnit = 'seconds' | 'milliseconds';

export interface HookRenderOptions {
  scope?: InstallScope;
  enableHooks?: boolean;
  enableBlockingHooks?: boolean;
  command?: string;
}

export interface HookRenderResult {
  intents: ArtifactIntent[];
  diagnostics: string[];
}

export interface HookTransport {
  exitCode: 0 | 2;
  stderr?: string;
}

const HOOK_COMMAND = 'node .agents/monomind/hook-bridge.mjs';

function hookCommand(options: HookRenderOptions): string {
  return [
    options.command ?? HOOK_COMMAND,
    options.enableBlockingHooks ? '--enable-blocking-hooks' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function hooksEnabled(options: HookRenderOptions): boolean {
  // --enable-hooks is the backwards-compatible opt-in alias. The blocking
  // spelling also opts in, then changes the explicit policy mode.
  return options.enableHooks === true || options.enableBlockingHooks === true;
}

function hasVerifiedNativeHooks(adapter: PlatformAdapter): boolean {
  return (
    adapter.capabilities.hooks === 'native' &&
    ['schema', 'runtime'].includes(adapter.verification.hooks.level)
  );
}

function renderCodexHooks(options: HookRenderOptions): string {
  const command = JSON.stringify(hookCommand(options));
  return [
    '# Codex hook timeouts are measured in seconds.',
    '# Hooks require workspace trust. This opt-in enables Codex hooks for this workspace.',
    '[features]',
    'hooks = true',
    '[[hooks.PreToolUse]]',
    'matcher = ".*"',
    '[[hooks.PreToolUse.hooks]]',
    'type = "command"',
    `command = ${command}`,
    'timeout = 2',
    '',
    '[[hooks.PostToolUse]]',
    'matcher = ".*"',
    '[[hooks.PostToolUse.hooks]]',
    'type = "command"',
    `command = ${command}`,
    'timeout = 10',
    '',
  ].join('\n');
}

function renderKimiHooks(options: HookRenderOptions): string {
  const command = hookCommand(options);
  return `${JSON.stringify(
    {
      hooks: [
        { event: 'PreToolUse', command, timeout: 2_000 },
        { event: 'PostToolUse', command, timeout: 10_000 },
      ],
    },
    null,
    2,
  )}\n`;
}

/**
 * Render no hook configuration unless the caller opted in and the adapter has
 * a verified native hook capability. SessionStart is intentionally absent:
 * Monomind never installs prompt-injection hooks.
 */
export function renderHooks(adapter: PlatformAdapter, options: HookRenderOptions = {}): string {
  if (!hooksEnabled(options) || !hasVerifiedNativeHooks(adapter)) return '';

  switch (adapter.id) {
    case 'codex':
      return renderCodexHooks(options);
    case 'kimi':
      return renderKimiHooks(options);
    default:
      return '';
  }
}

/**
 * A plan owns both sides of a hook integration: a verified configuration and
 * the locally executable neutral bridge it invokes. Never install either
 * half until a caller explicitly opts in.
 */
export function renderHookArtifacts(
  adapter: PlatformAdapter,
  options: HookRenderOptions = {},
): HookRenderResult {
  if (!hooksEnabled(options)) return { intents: [], diagnostics: [] };
  if (options.scope === 'user') {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: hooks are project-scoped; no user-scope hook was installed`,
      ],
    };
  }
  if (!hasVerifiedNativeHooks(adapter)) {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: hook configuration is not upstream-verified; no hook was installed`,
      ],
    };
  }

  const content = renderHooks(adapter, options);
  const hookLocation = adapter.paths.locations.hook?.project;
  const bridgeLocation = adapter.paths.locations.hook_bridge?.project;
  if (
    !content ||
    !hookLocation ||
    hookLocation === 'cli_fallback' ||
    hookLocation === 'discovery' ||
    !bridgeLocation ||
    bridgeLocation === 'cli_fallback' ||
    bridgeLocation === 'discovery'
  ) {
    return {
      intents: [],
      diagnostics: [
        `${adapter.displayName}: no verified project hook artifact location is declared`,
      ],
    };
  }

  return {
    intents: [
      {
        kind: 'hook_bridge',
        locationKey: 'hook_bridge',
        content: renderNeutralHookBridge(),
        scope: options.scope ?? 'project',
        replace: 'managed_block',
        marker: `hook-bridge:${adapter.id}`,
        format: bridgeLocation.format,
      },
      {
        kind: 'hook',
        locationKey: 'hook',
        content,
        scope: options.scope ?? 'project',
        replace: 'managed_block',
        marker: `hooks:${adapter.id}`,
        format: hookLocation.format,
      },
    ],
    diagnostics: [],
  };
}

/** The native command-hook protocol shared by Codex and Kimi. */
export function mapHookDecision(
  platform: PlatformAdapter['id'],
  decision: { action: 'allow' | 'block' | 'observe'; reason?: string },
): HookTransport | undefined {
  if (platform !== 'codex' && platform !== 'kimi') return undefined;
  if (decision.action !== 'block') return { exitCode: 0 };
  return {
    exitCode: 2,
    stderr: JSON.stringify({ decision: 'block', reason: decision.reason }),
  };
}

/** Testable unit assertion kept next to the renderer data it protects. */
export function assertTimeoutUnit(rendered: string, unit: HookTimeoutUnit): boolean {
  if (unit === 'seconds') {
    return (
      /timeout = 2\b/.test(rendered) &&
      /timeout = 10\b/.test(rendered) &&
      !/timeout = (?:2000|10000)\b/.test(rendered)
    );
  }

  try {
    const parsed: unknown = JSON.parse(rendered);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { hooks?: unknown }).hooks)
    )
      return false;
    const timeouts = (parsed as { hooks: Array<{ timeout?: unknown }> }).hooks.map(
      ({ timeout }) => timeout,
    );
    return timeouts.includes(2_000) && timeouts.includes(10_000);
  } catch {
    return false;
  }
}
