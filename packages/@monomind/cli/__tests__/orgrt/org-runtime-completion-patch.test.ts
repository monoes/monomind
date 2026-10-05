// packages/@monomind/cli/__tests__/orgrt/org-runtime-completion-patch.test.ts
// P3.2: the dashboard reads run_config.completion through the shared accessor.
// A legacy string shows exactly as before; a sections-v1 object shows its mode
// and survives a Config-tab save with its protocol; null is refused for it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ORG_DIR } from '../../src/orgrt/types.js';
import { ConfigRejected, patchOrgConfig, runtimeView } from '../../src/ui/org-runtime.mjs';
import { sectionsRaw } from './support/sections-defs.js';

let root: string;
const file = () => join(root, ORG_DIR, 'o.json');
const save = (def: unknown) => writeFileSync(file(), JSON.stringify(def));
const saved = () => JSON.parse(readFileSync(file(), 'utf8'));

const legacy = (completion?: unknown) => ({
  name: 'o',
  goal: 'g',
  run_config: completion === undefined ? {} : { completion },
  roles: [{ id: 'lead', title: 'Lead' }],
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'completion-patch-'));
  mkdirSync(join(root, ORG_DIR), { recursive: true });
});

describe('dashboard display (settings.completion)', () => {
  it.each([
    ['boss', 'boss'],
    ['dag', 'dag'],
    [undefined, 'boss'],
  ])('legacy %s shows %s, as before', async (completion, shown) => {
    save(legacy(completion));
    expect((await runtimeView(root, 'o')).settings.completion).toBe(shown);
  });

  it('a legacy value outside boss/dag is still echoed verbatim', async () => {
    save(legacy('sometimes'));
    expect((await runtimeView(root, 'o')).settings.completion).toBe('sometimes');
  });

  it('a sections-v1 object shows its mode, never the object and never the default', async () => {
    save(sectionsRaw());
    expect((await runtimeView(root, 'o')).settings.completion).toBe('dag');
    save(sectionsRaw((r) => (r.run_config.completion.mode = 'boss')));
    expect((await runtimeView(root, 'o')).settings.completion).toBe('boss');
  });
});

describe('Config-tab save (patchOrgConfig)', () => {
  it('a legacy org still saves a string and clears it with null', () => {
    save(legacy('boss'));
    patchOrgConfig(root, 'o', { run_config: { completion: 'dag' } });
    expect(saved().run_config.completion).toBe('dag');
    patchOrgConfig(root, 'o', { run_config: { completion: null } });
    expect(saved().run_config).not.toHaveProperty('completion');
  });

  it('a sections org: the string maps onto completion.mode and the protocol is kept', () => {
    save(sectionsRaw());
    patchOrgConfig(root, 'o', { run_config: { completion: 'boss' } });
    expect(saved().run_config.completion).toEqual({ mode: 'boss', protocol: 'sections-v1' });
  });

  it('a sections org: null is refused and the file is untouched', () => {
    save(sectionsRaw());
    const before = readFileSync(file(), 'utf8');
    expect(() => patchOrgConfig(root, 'o', { run_config: { completion: null } })).toThrow(ConfigRejected);
    expect(readFileSync(file(), 'utf8')).toBe(before);
  });

  it('a sections org: an invalid value is refused by validation', () => {
    save(sectionsRaw());
    expect(() => patchOrgConfig(root, 'o', { run_config: { completion: 'sometimes' } })).toThrow(ConfigRejected);
  });

  it('a sections org: an unrelated patch keeps the object byte for byte', () => {
    save(sectionsRaw());
    patchOrgConfig(root, 'o', { goal: 'new goal' });
    expect(saved().run_config.completion).toEqual({ mode: 'dag', protocol: 'sections-v1' });
  });
});
