import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEOUTS,
  parseNormalizedHookEvent,
  renderNeutralHookBridge,
  runHook,
  type HookPolicy,
  type NormalizedHookEvent,
} from '../../src/platform-adapters/hook-bridge.js';
import {
  assertTimeoutUnit,
  mapHookDecision,
  renderHookArtifacts,
  renderHooks,
} from '../../src/platform-adapters/renderers/hooks.js';
import { getRenderer } from '../../src/platform-adapters/renderers/index.js';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import type { PlatformAdapter } from '../../src/platform-adapters/types.js';

const event: NormalizedHookEvent = {
  event: 'PreToolUse',
  tool: 'shell_command',
  cwd: '/x',
  sessionId: 's1',
  input: {},
};

const observePolicy: HookPolicy = {
  mode: 'observe',
  timeoutMs: { PreToolUse: 20 },
};

function withVerifiedNativeHooks(adapter: PlatformAdapter): PlatformAdapter {
  return {
    ...adapter,
    capabilities: { ...adapter.capabilities, hooks: 'native' },
    verification: {
      ...adapter.verification,
      hooks: {
        level: 'schema',
        sourceUrl: 'https://example.test/hooks',
        sourceLocator: 'fixture schema',
        verifiedAt: '2026-08-24',
      },
    },
  };
}

describe('neutral platform hook contracts', () => {
  it('parses only complete normalized hook events', () => {
    expect(parseNormalizedHookEvent(event)).toEqual(event);
    expect(parseNormalizedHookEvent({ ...event, sessionId: 1 })).toBeNull();
  });

  it('uses the documented per-event timeout budgets', () => {
    expect(DEFAULT_TIMEOUTS).toEqual({
      PreToolUse: 2_000,
      PostToolUse: 10_000,
      SessionStart: 2_000,
      SessionEnd: 2_000,
    });
  });

  it('never converts a bridge failure into a blocked tool call in observe mode', async () => {
    const decision = await runHook(event, observePolicy, async () => {
      throw new Error('bridge unavailable');
    });

    expect(decision).toEqual({ action: 'allow' });
  });

  it('fails open after its per-event timeout in observe mode', async () => {
    const decision = await runHook(event, observePolicy, async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { action: 'block' as const };
    });

    expect(decision).toEqual({ action: 'allow' });
  });

  it('never renders a SessionStart prompt injection for any platform', () => {
    for (const platform of PLATFORM_IDS) {
      const rendered = renderHooks(withVerifiedNativeHooks(PLATFORM_REGISTRY[platform]), {
        enableHooks: true,
      });
      expect(rendered).not.toContain('SessionStart prompt');
    }
  });

  it.each([
    ['codex', 'seconds'],
    ['kimi', 'milliseconds'],
  ] as const)('renders %s hook timeouts in %s', (platform, unit) => {
    const rendered = renderHooks(withVerifiedNativeHooks(PLATFORM_REGISTRY[platform]), {
      enableHooks: true,
    });

    expect(rendered).not.toBe('');
    expect(assertTimeoutUnit(rendered, unit)).toBe(true);
  });

  it('requires a hook opt-in and refuses unverified configurations', () => {
    const codex = PLATFORM_REGISTRY.codex;

    expect(renderHookArtifacts(codex).intents).toEqual([]);
    expect(renderHookArtifacts(codex, { enableHooks: true }).intents).toEqual([]);
    expect(renderHookArtifacts(codex, { enableHooks: true }).diagnostics.join(' ')).toContain(
      'not upstream-verified',
    );
  });

  it('connects hook rendering to platform plans without making hooks implicit', () => {
    const request = { platform: 'codex' as const, scope: 'project' as const, path: '/fixture' };
    const defaultPlan = getRenderer('codex').render(PLATFORM_REGISTRY.codex, request);
    const optedInPlan = getRenderer('codex').render(PLATFORM_REGISTRY.codex, {
      ...request,
      enableHooks: true,
    });

    expect(defaultPlan.intents.some((intent) => intent.kind === 'hook')).toBe(false);
    expect(optedInPlan.intents.some((intent) => intent.kind === 'hook')).toBe(false);
    expect(optedInPlan.diagnostics.join(' ')).toContain('not upstream-verified');
  });

  it('never turns an explicit user-scope request into a project hook write', () => {
    const result = renderHookArtifacts(withVerifiedNativeHooks(PLATFORM_REGISTRY.codex), {
      scope: 'user',
      enableHooks: true,
    });

    expect(result.intents).toEqual([]);
    expect(result.diagnostics.join(' ')).toContain('project-scoped');
  });

  it('installs a standalone bridge and Codex config only for a verified opt-in', () => {
    const result = renderHookArtifacts(withVerifiedNativeHooks(PLATFORM_REGISTRY.codex), {
      enableBlockingHooks: true,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.intents.map((intent) => intent.kind)).toEqual(['hook_bridge', 'hook']);
    expect(result.intents[0]?.content).not.toContain('.claude/helpers');
    expect(result.intents[0]?.content).not.toContain('CLAUDE_PROJECT_DIR');
    expect(result.intents[1]?.content).toContain('[features]\nhooks = true');
    expect(result.intents[1]?.content).toContain('--enable-blocking-hooks');
  });

  it('executes the neutral bridge stdin-safe, fail-open, and records latency', () => {
    const root = mkdtempSync(join(tmpdir(), 'monomind-hook-bridge-'));
    const bridge = join(root, 'hook-bridge.mjs');
    try {
      writeFileSync(bridge, renderNeutralHookBridge(), 'utf8');
      const valid = spawnSync(process.execPath, [bridge], {
        cwd: root,
        input: JSON.stringify({
          hook_event_name: 'PreToolUse',
          tool_name: 'shell_command',
          cwd: root,
          session_id: 'session-1',
          tool_input: { command: 'true' },
        }),
        encoding: 'utf8',
      });

      expect(valid.status).toBe(0);
      expect(valid.stdout).toBe('');
      expect(JSON.parse(valid.stderr)).toMatchObject({ decision: 'allow' });
      const latency = readFileSync(join(root, '.monomind', 'hook-latency.jsonl'), 'utf8');
      expect(JSON.parse(latency)).toMatchObject({ event: 'PreToolUse', action: 'allow' });

      const invalid = spawnSync(process.execPath, [bridge], {
        cwd: root,
        input: '{invalid json',
        encoding: 'utf8',
      });
      expect(invalid.status).toBe(0);
      expect(invalid.stdout).toBe('');
      expect(JSON.parse(invalid.stderr)).toMatchObject({ decision: 'allow' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps only explicit block decisions to native protocol exits', () => {
    expect(mapHookDecision('codex', { action: 'allow' })).toEqual({ exitCode: 0 });
    expect(mapHookDecision('kimi', { action: 'block', reason: 'policy' })).toEqual({
      exitCode: 2,
      stderr: JSON.stringify({ decision: 'block', reason: 'policy' }),
    });
    expect(mapHookDecision('opencode', { action: 'block' })).toBeUndefined();
  });
});
