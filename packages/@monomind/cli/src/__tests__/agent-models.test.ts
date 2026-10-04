// #369: `agent models` — each runtime's real model list.
import { describe, expect, it } from 'vitest';
import {
  listRuntimeModels,
  markAliases,
  parseAgyModels,
  parseClaudeModels,
  parseCodexModels,
  parseOpencodeModels,
} from '../orgrt/agent-models.js';

describe('agent models parsers', () => {
  it('claude: maps supportedModels(), marks default, keeps resolved id and effort levels', () => {
    const models = parseClaudeModels([
      {
        value: 'default',
        resolvedModel: 'claude-opus-5-5',
        displayName: 'Default (recommended)',
        description: 'Opus 5.5 · Best for everyday, complex tasks',
        supportedEffortLevels: ['low', 'high'],
      },
      { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1' },
      { displayName: 'no value — dropped' },
    ]);
    expect(models).toEqual([
      {
        id: 'default',
        resolved_id: 'claude-opus-5-5',
        label: 'Default (recommended)',
        description: 'Opus 5.5 · Best for everyday, complex tasks',
        default: true,
        effort_levels: ['low', 'high'],
      },
      { id: 'claude-fable-5-1', label: 'Fable 5.1' },
    ]);
  });

  it('claude: every entry is kept; opus is marked alias_of default (mono-agent looks up by id)', () => {
    const models = parseClaudeModels([
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet' },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus' },
    ]);
    expect(models).toEqual([
      {
        id: 'default',
        resolved_id: 'claude-opus-5-5',
        aliases: ['default', 'opus'],
        label: 'Default (recommended)',
        default: true,
      },
      { id: 'sonnet', resolved_id: 'claude-sonnet-5', label: 'Sonnet' },
      { id: 'opus', resolved_id: 'claude-opus-5-5', label: 'Opus', alias_of: 'default' },
    ]);
    // A lookup by id (mono-agent's `m.ID == "opus"`) still finds opus.
    expect(models.find((m) => m.id === 'opus')?.resolved_id).toBe('claude-opus-5-5');
    // A caller testing each model once skips alias_of entries.
    expect(models.filter((m) => !m.alias_of).map((m) => m.id)).toEqual(['default', 'sonnet']);
  });

  it('markAliases: an explicit id and a later alias of it; the alias keeps its own fields', () => {
    expect(
      markAliases([
        { id: 'claude-opus-5-5', label: 'Opus 5.5' },
        { id: 'default', resolved_id: 'claude-opus-5-5', label: 'Default', default: true },
        { id: 'haiku', resolved_id: 'claude-haiku-5', label: 'Haiku' },
      ]),
    ).toEqual([
      { id: 'claude-opus-5-5', label: 'Opus 5.5', aliases: ['claude-opus-5-5', 'default'] },
      {
        id: 'default',
        resolved_id: 'claude-opus-5-5',
        label: 'Default',
        default: true,
        alias_of: 'claude-opus-5-5',
      },
      { id: 'haiku', resolved_id: 'claude-haiku-5', label: 'Haiku' },
    ]);
  });

  it('codex: only visibility "list", effort levels from supported_reasoning_levels', () => {
    const stdout = JSON.stringify({
      models: [
        {
          slug: 'gpt-6-astra',
          display_name: 'GPT-6-Astra',
          description: 'Frontier',
          visibility: 'list',
          supported_reasoning_levels: [{ effort: 'low' }, { effort: 'max' }],
        },
        { slug: 'gpt-reserve', display_name: 'hidden', visibility: 'hide' },
      ],
    });
    expect(parseCodexModels(stdout)).toEqual([
      {
        id: 'gpt-6-astra',
        label: 'GPT-6-Astra',
        description: 'Frontier',
        effort_levels: ['low', 'max'],
      },
    ]);
  });

  it('antigravity: tab-separated id/label lines, skipping the progress line', () => {
    const stdout =
      'Fetching available models...\ngemini-3.8-flash-high\tGemini 3.8 Flash (High)\n\n';
    expect(parseAgyModels(stdout)).toEqual([
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)' },
    ]);
  });

  it('opencode: provider/model lines only', () => {
    expect(
      parseOpencodeModels('opencode/big-pickle\nsome log line\nanthropic/claude-sonnet-5\n'),
    ).toEqual([
      { id: 'opencode/big-pickle', label: 'opencode/big-pickle' },
      { id: 'anthropic/claude-sonnet-5', label: 'anthropic/claude-sonnet-5' },
    ]);
  });
});

describe('listRuntimeModels', () => {
  it('claude goes through the SDK lister (no CLI spawn)', async () => {
    const r = await listRuntimeModels('claude', {
      listClaude: async () => [
        { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5' },
      ],
      runCli: async () => {
        throw new Error('must not spawn a CLI for claude');
      },
    });
    expect(r).toMatchObject({
      v: 1,
      runtime: 'claude',
      supported: true,
      models: [{ id: 'sonnet', resolved_id: 'claude-sonnet-5', label: 'Sonnet 5' }],
    });
  });

  it('codex runs `<bin> debug models` on the resolved binary', async () => {
    let called: string[] = [];
    const r = await listRuntimeModels('codex', {
      env: { PATH: '', CODEX_CLI_BIN: process.execPath },
      runCli: async (bin, args) => {
        called = [bin, ...args];
        return JSON.stringify({
          models: [{ slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list' }],
        });
      },
    });
    expect(called).toEqual([process.execPath, 'debug', 'models']);
    expect(r.models).toEqual([{ id: 'gpt-5.5', label: 'GPT-5.5' }]);
  });

  it('a runtime without a listing command is supported:false with []', async () => {
    expect(await listRuntimeModels('crush')).toEqual({
      v: 1,
      runtime: 'crush',
      supported: false,
      models: [],
    });
  });

  it('dsh serves its curated list without spawning anything', async () => {
    const r = await listRuntimeModels('dsh', {
      env: { PATH: '' },
      runCli: async () => {
        throw new Error('must not spawn');
      },
    });
    expect(r).toMatchObject({ supported: true, curated: true });
    expect(r.error).toBeUndefined();
    expect(r.models.find((m) => m.default)?.id).toBe('deepseek-flash');
    expect(r.models.some((m) => m.id === 'openrouter/nvidia/nemotron-3-ultra-550b-a55b:free')).toBe(
      true,
    );
  });

  it('unknown runtime and missing binary are reported as errors', async () => {
    expect((await listRuntimeModels('nope')).error?.code).toBe('unknown-runtime');
    const missing = await listRuntimeModels('antigravity', { env: { PATH: '' } });
    expect(missing.error?.code).toBe('missing-binary');
    expect(missing.models).toEqual([]);
  });

  it('a failing CLI is list-failed, not a throw', async () => {
    const r = await listRuntimeModels('opencode', {
      env: { PATH: '', OPENCODE_BIN: process.execPath },
      runCli: async () => {
        throw new Error('boom');
      },
    });
    expect(r.error).toEqual({ code: 'list-failed', message: 'boom' });
  });
});

// Kilo's models command prints plain provider/model lines, regardless of its JSON run protocol.
it('Kilo model listing honors the same override as discovery', async () => {
  let called: string[] = [];
  const result = await listRuntimeModels('kilo', {
    env: { PATH: '', KILO_CLI_BIN: process.execPath },
    runCli: async (bin, args) => {
      if (args[0] === '--version') return '7.8.3\n';
      called = [bin, ...args];
      return 'anthropic/claude-sonnet-5\nnoise line\nopenai/gpt-6\n';
    },
  });
  expect(called).toEqual([process.execPath, 'models']);
  expect(result.models.map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-6']);
});
it('Freebuff explains why model discovery is unavailable', async () => {
  const result = await listRuntimeModels('freebuff');
  expect(result.supported).toBe(false);
  expect(result.reason).toMatch(/interactive/i);
});

it.each(['7.8.2', '', 'unknown'])(
  'Kilo model discovery refuses unverified version %j before requesting models',
  async (version) => {
    const calls: string[][] = [];
    const result = await listRuntimeModels('kilo', {
      env: { PATH: '', KILO_CLI_BIN: process.execPath },
      runCli: async (bin, args) => {
        calls.push([bin, ...args]);
        return version;
      },
    });
    expect(calls).toEqual([[process.execPath, '--version']]);
    expect(result).toMatchObject({
      supported: false,
      models: [],
      reason: expect.stringContaining('7.8.3'),
    });
  },
);
it('Kilo model discovery reports a failed version probe as an unsupported version', async () => {
  const result = await listRuntimeModels('kilo', {
    env: { PATH: '', KILO_CLI_BIN: process.execPath },
    runCli: async () => {
      throw new Error('version probe failed');
    },
  });
  expect(result).toMatchObject({
    supported: false,
    models: [],
    reason: expect.stringContaining('unverified'),
  });
});
