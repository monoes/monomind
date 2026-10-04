// packages/@monomind/cli/__tests__/orgrt/documents/completion-accessor.test.ts
// P3.2: the shared reader of run_config.completion. A legacy string and the
// sections-v1 object resolve to the same mode; the object also yields its
// protocol; an unknown protocol is a definition finding; no source file reads
// the field except through the accessor.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkCompletion } from '../../../src/orgrt/completion-gate.js';
import {
  completionDisplay,
  completionFindings,
  completionIsObject,
  completionMode,
  completionPolicy,
  completionProtocol,
  patchCompletion,
} from '../../../src/orgrt/documents/completion-accessor.js';
import { sectionsDefinitionFindings } from '../../../src/orgrt/documents/definition.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { sectionsRaw } from '../support/sections-defs.js';

const V1 = 'sections-v1';

describe('completionPolicy / completionMode / completionProtocol', () => {
  const table: Array<[string, unknown, 'boss' | 'dag', string | null]> = [
    ['legacy boss', 'boss', 'boss', null],
    ['legacy dag', 'dag', 'dag', null],
    ['object boss', { mode: 'boss', protocol: V1 }, 'boss', V1],
    ['object dag', { mode: 'dag', protocol: V1 }, 'dag', V1],
    ['unset', undefined, 'boss', null],
    ['null', null, 'boss', null],
    ['unknown string', 'sometimes', 'boss', null],
    ['unknown protocol keeps its text', { mode: 'dag', protocol: 'sections-v2' }, 'dag', 'sections-v2'],
    ['object with a bad mode', { mode: 'x', protocol: V1 }, 'boss', V1],
    ['object without a protocol', { mode: 'dag' }, 'dag', null],
    ['array', ['dag'], 'boss', null],
    ['number', 3, 'boss', null],
  ];
  it.each(table)('%s', (_n, completion, mode, protocol) => {
    const rc = { completion };
    expect(completionPolicy(rc)).toEqual({ mode, protocol });
    expect(completionMode(rc)).toBe(mode);
    expect(completionProtocol(rc)).toBe(protocol);
  });

  it('a missing run_config resolves as unset', () => {
    for (const rc of [undefined, null, {}]) expect(completionPolicy(rc)).toEqual({ mode: 'boss', protocol: null });
  });

  it('the string and the object of one mode resolve to the same mode', () => {
    for (const mode of ['boss', 'dag'] as const)
      expect(completionMode({ completion: { mode, protocol: V1 } })).toBe(completionMode({ completion: mode }));
  });

  it('completionIsObject is true for objects only', () => {
    expect(completionIsObject({ completion: { mode: 'dag', protocol: V1 } })).toBe(true);
    for (const c of ['dag', undefined, null, [1]]) expect(completionIsObject({ completion: c })).toBe(false);
  });
});

describe('completionDisplay', () => {
  it('echoes a legacy value verbatim, unset is boss', () => {
    expect(completionDisplay({ completion: 'dag' })).toBe('dag');
    expect(completionDisplay({ completion: 'boss' })).toBe('boss');
    expect(completionDisplay({})).toBe('boss');
    expect(completionDisplay(undefined)).toBe('boss');
    expect(completionDisplay({ completion: 'sometimes' })).toBe('sometimes');
  });
  it('shows an object by its mode, never the object', () => {
    expect(completionDisplay({ completion: { mode: 'dag', protocol: V1 } })).toBe('dag');
    expect(completionDisplay({ completion: { mode: 'boss', protocol: V1 } })).toBe('boss');
  });
});

describe('completionFindings and the definition check', () => {
  const d = (v: unknown) => JSON.stringify(v);
  it('is clean for the v1 object', () => {
    expect(completionFindings({ completion: { mode: 'dag', protocol: V1 } }, d)).toEqual([]);
  });
  it.each([
    ['a string', 'dag', 'run_config.completion: a sections org must set'],
    ['missing', undefined, 'run_config.completion: a sections org must set'],
    ['an unknown protocol', { mode: 'dag', protocol: 'sections-v2' }, 'run_config.completion.protocol: must be "sections-v1"'],
    ['no protocol', { mode: 'dag' }, 'run_config.completion.protocol: must be "sections-v1"'],
  ])('refuses %s', (_n, completion, text) => {
    const [first, ...rest] = completionFindings({ completion }, d);
    expect(first).toContain(text);
    expect(rest).toEqual([]);
  });
  it('the sections definition check reports an unknown protocol through it', () => {
    const def = OrgDefSchema.parse(sectionsRaw((r) => (r.run_config.completion.protocol = 'sections-v2')));
    expect(sectionsDefinitionFindings(def).errors.join('\n')).toContain('"sections-v2"');
  });
});

describe('patchCompletion (dashboard Config tab)', () => {
  const obj = { completion: { mode: 'dag', protocol: V1 } };
  it('maps a string onto the mode of an object and keeps the protocol', () => {
    expect(patchCompletion(obj, 'boss')).toEqual({ ok: true, value: { mode: 'boss', protocol: V1 } });
  });
  it('refuses null for an object, it would delete the discriminator', () => {
    const r = patchCompletion(obj, null);
    expect(r.ok).toBe(false);
  });
  it('applies a legacy value as before, including null', () => {
    expect(patchCompletion({ completion: 'boss' }, 'dag')).toEqual({ ok: true, value: 'dag' });
    expect(patchCompletion({}, null)).toEqual({ ok: true, value: null });
    expect(patchCompletion(undefined, 'dag')).toEqual({ ok: true, value: 'dag' });
  });
});

describe('a legacy parser', () => {
  it('(frozen pre-change shape) rejects the object and accepts the strings', () => {
    const legacy = z.object({ completion: z.enum(['boss', 'dag']).optional() });
    expect(legacy.safeParse({ completion: { mode: 'dag', protocol: V1 } }).success).toBe(false);
    expect(legacy.safeParse({ completion: 'dag' }).success).toBe(true);
  });
});

describe('org_complete mode comes from the accessor', () => {
  const facts = (completion: unknown) => ({
    outcome: 'achieved' as const,
    blocker: undefined,
    blockerDetail: undefined,
    mode: completionMode({ completion }),
    maxBudgetFraction: 0,
    pendingHumanWaits: 0,
    openBlockingQuestions: [],
    hasActiveBlock: false,
    hasPendingWork: true,
  });
  it('a dag object org is refused with runnable work left, like the dag string', () => {
    const viaObject = checkCompletion(facts({ mode: 'dag', protocol: V1 }));
    expect(viaObject).toMatch(/runnable work remains/);
    expect(viaObject).toBe(checkCompletion(facts('dag')));
  });
  it('a boss object org is allowed, like the boss string', () => {
    expect(checkCompletion(facts({ mode: 'boss', protocol: V1 }))).toBe(checkCompletion(facts('boss')));
    expect(checkCompletion(facts({ mode: 'boss', protocol: V1 }))).toBeNull();
  });
});

describe('no source file reads run_config.completion except through the accessor', () => {
  const src = join(__dirname, '../../../src');
  const ALLOWED = new Set([
    'orgrt/documents/completion-accessor.ts', // the accessor itself
    'orgrt/types.ts', // the schema field and the default definition
    'ui/dashboard.html', // browser script: cannot import the module (display only; see below)
  ]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (name === '__tests__' || name === 'node_modules') continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|mjs|js|html)$/.test(name)) files.push(p);
    }
  };
  walk(src);
  // Prose inside tool-description and refusal strings that names the setting.
  const MESSAGE_TEXT: Array<[string, string]> = [
    ['orgrt/completion-gate.ts', "org_complete refused (run_config.completion: 'dag')"],
    ['orgrt/validate-checklist.ts', "'run_config.completion as an object is only supported"],
    ['orgrt/org-tools.ts', "if this org's run_config.completion is set to 'dag'"],
  ];

  // `.completion` / `['completion']` / `completion:` as a property read or write
  // (not completion_evidence, not prose in a comment or message).
  const READ = /(?:\.|\?\.|\[['"])completion\b/;
  const strip = (line: string) => line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');

  it('finds no reader outside the allowlist', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = relative(src, f);
      if (ALLOWED.has(rel)) continue;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (MESSAGE_TEXT.some(([m, t]) => m === rel && line.includes(t))) return;
          if (READ.test(strip(line))) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it('the scan sees the readers the accessor replaced (guards against a dead regex)', () => {
    expect(READ.test('const m = def.run_config.completion;')).toBe(true);
    expect(READ.test("const m = rc['completion'];")).toBe(true);
    expect(READ.test('rc.completion_evidence')).toBe(false);
    expect(files.some((f) => f.endsWith('orgrt/role-session-opts.ts'))).toBe(true);
  });
});
