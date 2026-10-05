// packages/@monomind/cli/__tests__/orgrt/documents/writer-policy-engine.test.ts
// P4.2: pins the PolicyEngine behaviour the writer overlay relies on, before P4.4 relies on it: a role with
// `fileWrite: []` is refused on every file-mutation tool call (inside the workspace, outside it, with no path),
// while its reads and a writer with a scoped list are unaffected. If this ever stops holding, the overlay must
// use `denyTools` for the file tools instead (13.2 P4.2).
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { applyWriterOverlay, overlayFor } from '../../../src/orgrt/documents/writer-policy.js';
import { PolicyEngine } from '../../../src/orgrt/policy.js';

const mk = () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'wpe-')));
  mkdirSync(join(cwd, 'src'), { recursive: true });
  writeFileSync(join(cwd, 'src', 'a.ts'), 'x');
  return { cwd, bus: new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'wpe-bus-'))) };
};

const CALLS: [string, (p: string) => Record<string, unknown>][] = [
  ['Write', (p) => ({ file_path: p, content: 'x' })],
  ['Edit', (p) => ({ file_path: p, old_string: 'x', new_string: 'y' })],
  [
    'MultiEdit',
    (p) => ({ file_path: p, edits: [{ file_path: p, old_string: 'x', new_string: 'y' }] }),
  ],
  ['NotebookEdit', (p) => ({ notebook_path: p, new_source: 'x' })],
];

describe('PolicyEngine with fileWrite [] (what the read-only overlay sets)', () => {
  for (const [tool, input] of CALLS) {
    it(`${tool} is denied inside the workspace, at its root, outside it, and with a relative path`, async () => {
      const { cwd, bus } = mk();
      const p = new PolicyEngine('qa', { fileWrite: [] }, bus, cwd);
      for (const path of [join(cwd, 'src', 'a.ts'), join(cwd, 'new.ts'), '/etc/hosts', 'src/a.ts'])
        expect((await p.decide(tool, input(path))).behavior, `${tool} ${path}`).toBe('deny');
    });
  }

  it('denies a write call that names no path, and says the scope is restricted', async () => {
    const { cwd, bus } = mk();
    const p = new PolicyEngine('qa', { fileWrite: [] }, bus, cwd);
    const d = await p.decide('Write', { content: 'x' });
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/scope is restricted/);
  });

  it('denies even with the workspace as an extra root and an allowWrite entry for it', async () => {
    const { cwd, bus } = mk();
    const p = new PolicyEngine('qa', { fileWrite: [], sandbox: { allowWrite: [cwd] } }, bus, cwd, [cwd], cwd);
    const d = await p.decide('Write', { file_path: join(cwd, 'src', 'a.ts'), content: 'x' });
    expect(d.behavior).toBe('deny');
  });

  it('still allows reads', async () => {
    const { cwd, bus } = mk();
    const p = new PolicyEngine('qa', { fileWrite: [] }, bus, cwd);
    expect((await p.decide('Read', { file_path: join(cwd, 'src', 'a.ts') })).behavior).toBe('allow');
    expect((await p.decide('Grep', { path: cwd })).behavior).toBe('allow');
  });
});

describe('PolicyEngine built from the overlay', () => {
  const def = {
    name: 'o',
    sections: { build: { members: ['dev'], writes: ['src/**'] }, review: { members: ['qa'] } },
    roles: [
      { id: 'boss', reports_to: null, type: 'boss' },
      { id: 'dev', reports_to: 'boss' },
      { id: 'qa', reports_to: 'boss' },
    ],
  };

  it('the writer writes inside its writes and is refused outside; the other roles are refused everywhere', async () => {
    const { cwd, bus } = mk();
    const engine = (id: string) =>
      new PolicyEngine(id, applyWriterOverlay(undefined, overlayFor(def, id)) ?? {}, bus, cwd);
    const write = async (id: string, path: string) =>
      (await engine(id).decide('Write', { file_path: join(cwd, path), content: 'x' })).behavior;
    expect(await write('dev', 'src/a.ts')).toBe('allow');
    expect(await write('dev', 'README.md')).toBe('deny');
    expect(await write('qa', 'src/a.ts')).toBe('deny');
    expect(await write('boss', 'src/a.ts')).toBe('deny');
  });
});
