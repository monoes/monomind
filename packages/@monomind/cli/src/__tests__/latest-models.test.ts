// Models are never older than the newest one known: defaults, tiers and pins
// resolve to the newest of the live catalog and a maintained floor.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LATEST_FLOOR,
  latestModel,
  newestModel,
  outdatedModelHint,
  parseModelId,
  readCatalog,
  refreshLatestModels,
} from '../latest-models.js';
import { isBlockedModel } from '../model-guard.js';
import { BUILTIN_COST_TIERS } from '../orgrt/cost-tier.js';
import { resolveModel } from '../orgrt/session-prompt.js';
import { OrgDefSchema } from '../orgrt/types.js';
import { checklistFindings } from '../orgrt/validate-checklist.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'latest-models-'));
  file = join(dir, 'latest-models.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseModelId', () => {
  it('reads runtime, family and version from the three vendors', () => {
    expect(parseModelId('claude-opus-5-5')).toEqual({
      runtime: 'claude',
      family: 'opus',
      version: [5, 5],
    });
    expect(parseModelId('claude-sonnet-5')).toEqual({
      runtime: 'claude',
      family: 'sonnet',
      version: [5, 0],
    });
    expect(parseModelId('claude-haiku-4-5-20251001')).toEqual({
      runtime: 'claude',
      family: 'haiku',
      version: [4, 5],
    });
    expect(parseModelId('claude-sonnet-4-20250514')).toEqual({
      runtime: 'claude',
      family: 'sonnet',
      version: [4, 0],
    });
    expect(parseModelId('gpt-5.6-terra')).toEqual({
      runtime: 'codex',
      family: 'terra',
      version: [5, 6],
    });
    expect(parseModelId('gpt-6-sol')).toEqual({ runtime: 'codex', family: 'sol', version: [6, 0] });
    expect(parseModelId('gpt-6.1-sol')).toEqual({
      runtime: 'codex',
      family: 'sol',
      version: [6, 1],
    });
    expect(parseModelId('gemini-3.8-flash-high')).toEqual({
      runtime: 'antigravity',
      family: 'flash-high',
      version: [3, 8],
    });
  });

  it('returns null for names it does not know', () => {
    for (const id of ['default', 'opus', 'kimi-code/k3', 'glm-5.2', 'gpt-5.5', '']) {
      expect(parseModelId(id), id).toBeNull();
    }
  });
});

describe('newestModel', () => {
  it('picks the highest version in a family, skipping other families and blocked models', () => {
    const ids = [
      'claude-sonnet-5',
      'claude-sonnet-5-5',
      'claude-sonnet-4-6',
      'claude-opus-5-5',
      'claude-fable-5-1',
    ];
    expect(newestModel(ids, 'claude', 'sonnet')).toBe('claude-sonnet-5-5');
    expect(newestModel(ids, 'claude', 'opus')).toBe('claude-opus-5-5');
    expect(newestModel(ids, 'claude', 'haiku')).toBeUndefined();
    expect(newestModel(['gpt-6-astra', 'gpt-5.6-terra'], 'codex', 'astra')).toBeUndefined();
  });

  it('compares versions numerically, not as text', () => {
    expect(newestModel(['gpt-5.9-terra', 'gpt-5.10-terra'], 'codex', 'terra')).toBe(
      'gpt-5.10-terra',
    );
  });
});

describe('latestModel', () => {
  it('uses the floor when there is no catalog', () => {
    writeFileSync(file, '{}');
    expect(latestModel('claude', 'haiku', { file })).toBe(LATEST_FLOOR.claude.haiku);
  });

  it('takes a newer catalog entry over the floor', () => {
    writeFileSync(
      file,
      JSON.stringify({ claude: ['claude-sonnet-5-6'], codex: ['gpt-5.7-terra'] }),
    );
    expect(latestModel('claude', 'sonnet', { file })).toBe('claude-sonnet-5-6');
    expect(latestModel('codex', 'terra', { file })).toBe('gpt-5.7-terra');
  });

  it('keeps the floor when the catalog lags behind it (the local Haiku alias is 4.5)', () => {
    writeFileSync(file, JSON.stringify({ claude: ['claude-haiku-4-5-20251001'] }));
    expect(latestModel('claude', 'haiku', { file })).toBe('claude-haiku-5-5');
  });

  it('survives a missing or corrupt cache file', () => {
    expect(latestModel('claude', 'opus', { file: join(dir, 'absent.json') })).toBe(
      LATEST_FLOOR.claude.opus,
    );
    writeFileSync(file, '{not json');
    expect(latestModel('claude', 'opus', { file })).toBe(LATEST_FLOOR.claude.opus);
  });

  it('the floor holds the newest known models and none is blocked', () => {
    expect(LATEST_FLOOR.claude).toEqual({
      opus: 'claude-opus-5-5',
      sonnet: 'claude-sonnet-5-5',
      haiku: 'claude-haiku-5-5',
    });
    expect(LATEST_FLOOR.codex.terra).toBe('gpt-5.6-terra');
    expect(LATEST_FLOOR.antigravity['flash-high']).toBe('gemini-3.8-flash-high');
    for (const runtime of Object.values(LATEST_FLOOR)) {
      for (const id of Object.values(runtime)) expect(isBlockedModel(id)).toBe(false);
    }
  });
});

describe('refreshLatestModels', () => {
  it('stores each runtime catalog, without blocked models', async () => {
    await refreshLatestModels({
      file,
      now: () => 1000,
      list: async (runtime) =>
        runtime === 'claude'
          ? ['claude-sonnet-5-5', 'claude-fable-5-1', 'sonnet']
          : runtime === 'codex'
            ? ['gpt-6-astra', 'gpt-5.6-terra']
            : ['gemini-3.8-flash-high'],
    });
    expect(readCatalog(file)).toEqual({
      claude: ['claude-sonnet-5-5', 'sonnet'],
      codex: ['gpt-5.6-terra'],
      antigravity: ['gemini-3.8-flash-high'],
    });
  });

  it('keeps the old catalog for a runtime whose listing fails', async () => {
    writeFileSync(file, JSON.stringify({ codex: ['gpt-5.7-terra'] }));
    await refreshLatestModels({
      file,
      list: async (runtime) => {
        if (runtime === 'codex') throw new Error('offline');
        return ['claude-sonnet-5-5'];
      },
    });
    expect(readCatalog(file).codex).toEqual(['gpt-5.7-terra']);
    expect(readCatalog(file).claude).toEqual(['claude-sonnet-5-5']);
  });

  it('does nothing while the catalog is younger than maxAgeMs', async () => {
    await refreshLatestModels({ file, now: () => 1000, list: async () => ['claude-sonnet-5-5'] });
    const before = readFileSync(file, 'utf8');
    let called = false;
    await refreshLatestModels({
      file,
      now: () => 2000,
      maxAgeMs: 5000,
      list: async () => {
        called = true;
        return [];
      },
    });
    expect(called).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

describe('outdatedModelHint', () => {
  it('names the newer model when a pin is older than the newest in its family', () => {
    expect(outdatedModelHint('claude-sonnet-5', { file })).toBe('claude-sonnet-5-5');
    expect(outdatedModelHint('claude-haiku-4-5-20251001', { file })).toBe('claude-haiku-5-5');
    expect(outdatedModelHint('claude-opus-4-8', { file })).toBe('claude-opus-5-5');
    expect(outdatedModelHint('gemini-3.6-flash-high', { file })).toBe('gemini-3.8-flash-high');
  });

  it('says nothing for a current pin or a name it cannot judge', () => {
    for (const id of [
      'claude-opus-5-5',
      'gpt-5.6-terra',
      'gemini-3.8-flash-high',
      'opus',
      'kimi-code/k3',
      'glm-5.2',
    ]) {
      expect(outdatedModelHint(id, { file }), id).toBeUndefined();
    }
  });
});

describe('where models are chosen for the user', () => {
  const role = (extra: Record<string, unknown> = {}) =>
    OrgDefSchema.parse({
      name: 't',
      goal: 'g',
      roles: [
        {
          id: 'boss',
          title: 'Boss',
          type: 'boss',
          reports_to: null,
          responsibilities: ['x'],
          ...extra,
        },
      ],
    }).roles[0];

  it('a role with no model resolves to the newest default for its runtime', () => {
    expect(resolveModel(role(), 'claude')).toBe(latestModel('claude', 'sonnet'));
    expect(resolveModel(role(), 'codex')).toBe(latestModel('codex', 'terra'));
    expect(resolveModel(role(), 'antigravity')).toBe(latestModel('antigravity', 'flash-high'));
    expect(resolveModel(role(), 'antigravity')).toBe('gemini-3.8-flash-high');
  });

  it('the built-in cost tiers are the newest opus, sonnet and haiku', () => {
    expect(BUILTIN_COST_TIERS.standard.claude.model).toBe(latestModel('claude', 'opus'));
    expect(BUILTIN_COST_TIERS.economy.claude.model).toBe(latestModel('claude', 'sonnet'));
    expect(BUILTIN_COST_TIERS.budget.claude.model).toBe(latestModel('claude', 'haiku'));
    expect(BUILTIN_COST_TIERS.budget.anthropic.model).toBe('claude-haiku-5-5');
  });

  it('org validate warns about an older pin and says which model to use', () => {
    const def = OrgDefSchema.parse({
      name: 't',
      goal: 'g',
      roles: [
        {
          id: 'boss',
          title: 'Boss',
          type: 'boss',
          reports_to: null,
          responsibilities: ['lead the work with a self-contained brief'],
          adapter_config: { model: 'claude-haiku-4-5-20251001' },
        },
      ],
    });
    const { errors, warnings } = checklistFindings(def);
    expect(errors.filter((e) => /haiku/.test(e))).toEqual([]);
    expect(
      warnings.some(
        (w) => w.includes('claude-haiku-4-5-20251001') && w.includes('claude-haiku-5-5'),
      ),
    ).toBe(true);
  });
});
