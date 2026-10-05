// P3.6: the per-run documents runtime (bindings built from the validated definition) and the static access
// rules, as pure functions of the definition. No daemon, no model.
import { existsSync, readdirSync } from 'node:fs';
import { mkdtempSync } from '../../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bindingsFromDef, openDocumentsRuntime } from '../../../src/orgrt/documents/runtime.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { findingsOrg, sweepOrg } from '../support/doc-defs.js';

const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'doc-rt-'));
const parse = (raw: Record<string, any>) => OrgDefSchema.parse(raw);

describe('bindingsFromDef', () => {
  it('builds one binding per type from the publishing and consuming sections', () => {
    const b = bindingsFromDef(parse(findingsOrg({ qa: true })));
    expect(b).toHaveLength(1);
    expect(b[0].contract.type).toBe('findings');
    expect(b[0].section).toBe('research');
    expect(b[0].producers.sort()).toEqual(['research-lead', 'researcher']);
    expect(b[0].consumers).toEqual([
      { id: 'development', deciders: ['dev-lead'] },
      { id: 'qa', deciders: ['qa-lead'] },
    ]);
  });

  it('gives the sweep-3 shape eight per-worker contracts, each decided by the synthesiser', () => {
    const b = bindingsFromDef(parse(sweepOrg()));
    expect(b.map((x) => x.contract.type)).toEqual(Array.from({ length: 8 }, (_, i) => `module-sheets-w${i + 1}`));
    b.forEach((x, i) => {
      expect(x.section).toBe(`sweep-${i + 1}`);
      expect(x.producers).toEqual([`worker-${i + 1}`]);
      expect(x.consumers).toEqual([{ id: 'synthesis', deciders: ['synthesiser'] }]);
      expect(x.contract.max_publish_attempts).toBe(4);
    });
  });

  it('drops the contract fields that only hold their default (owner, provisional, confidential)', () => {
    const raw = findingsOrg();
    Object.assign(raw.documents.findings, { owner: null, provisional: false, confidential: false, acceptance: 'each' });
    expect(() => bindingsFromDef(parse(raw))).not.toThrow();
  });
});

describe('openDocumentsRuntime', () => {
  it('is undefined for a definition off the sections surface, and creates nothing on disk', () => {
    const raw = findingsOrg();
    delete raw.sections;
    const orgDir = tmp();
    expect(openDocumentsRuntime({ def: parse(raw), orgDir, run: 'run-1' })).toBeUndefined();
    expect(existsSync(join(orgDir, 'docs'))).toBe(false);
  });

  it('opens the store under docs/<run>, writes the contract snapshot, and exposes the seams', () => {
    const orgDir = tmp();
    const rt = openDocumentsRuntime({ def: parse(findingsOrg()), orgDir, run: 'run-1' });
    expect(rt).toBeDefined();
    expect(rt?.dir).toBe(join(orgDir, 'docs', 'run-1'));
    expect(readdirSync(join(orgDir, 'docs', 'run-1', 'contracts'))).toHaveLength(1);
    expect(typeof rt?.store.addGuard).toBe('function');
    expect(typeof rt?.store.onCommitted).toBe('function');
    expect(rt?.store.contracts().map((c) => c.type)).toEqual(['findings']);
  });

  it('explains a contract the dialect refuses, naming the type', () => {
    const raw = findingsOrg();
    raw.documents.findings.schema = { type: 'object', patternProperties: {} };
    expect(() => openDocumentsRuntime({ def: parse(raw), orgDir: tmp(), run: 'run-1' })).toThrow(/findings/);
  });

  it('close() stops the host: later calls are refused and nothing is written', () => {
    const rt = openDocumentsRuntime({ def: parse(findingsOrg()), orgDir: tmp(), run: 'run-1' });
    const host = rt?.forRole('researcher');
    rt?.close();
    expect(rt?.closed).toBe(true);
    const r = host?.publish({ type: 'findings', body: { summary: 'abc' } });
    expect(r).toMatchObject({ ok: false, code: 'RUNTIME_CLOSED' });
    expect(rt?.store.list()).toEqual([]);
    rt?.close(); // idempotent
  });
});

describe('static access rules', () => {
  const rt = () => openDocumentsRuntime({ def: parse(findingsOrg({ qa: true })), orgDir: tmp(), run: 'run-1' })!;

  it('publish: only the producing section roles', () => {
    const a = rt().access;
    expect(a.publishRefusal('researcher', 'findings')).toBeUndefined();
    expect(a.publishRefusal('research-lead', 'findings')).toBeUndefined();
    for (const r of ['boss', 'dev-lead', 'coder', 'qa-lead', 'observer'])
      expect(a.publishRefusal(r, 'findings'), r).toMatch(/section research/);
  });

  it('read level: root and producers everything, consuming leads everything, members and outsiders accepted only', () => {
    const a = rt().access;
    expect(a.readLevel('boss', 'findings')).toBe('all');
    expect(a.readLevel('researcher', 'findings')).toBe('all');
    expect(a.readLevel('research-lead', 'findings')).toBe('all');
    expect(a.readLevel('dev-lead', 'findings')).toBe('all');
    expect(a.readLevel('qa-lead', 'findings')).toBe('all');
    expect(a.readLevel('coder', 'findings')).toBe('accepted');
    expect(a.readLevel('observer', 'findings')).toBeUndefined();
  });

  it('visibility org lets any role read accepted versions', () => {
    const raw = findingsOrg();
    raw.documents.findings.visibility = 'org';
    const a = openDocumentsRuntime({ def: parse(raw), orgDir: tmp(), run: 'run-1' })!.access;
    expect(a.readLevel('observer', 'findings')).toBe('accepted');
    expect(a.readLevel('coder', 'findings')).toBe('accepted');
  });

  it('decide: only the declared decider of a consuming section', () => {
    const a = rt().access;
    expect(a.decideRefusal('dev-lead', 'findings')).toBeUndefined();
    expect(a.decideRefusal('qa-lead', 'findings')).toBeUndefined();
    for (const r of ['boss', 'coder', 'researcher', 'research-lead', 'observer'])
      expect(a.decideRefusal(r, 'findings'), r).toMatch(/development.*dev-lead|dev-lead.*development/s);
  });

  it('the refusals name the rule and a remedy', () => {
    const a = rt().access;
    expect(a.publishRefusal('coder', 'findings')).toBe(
      'coder may not publish "findings": only roles of section research (research-lead, researcher) publish it',
    );
    expect(a.readRefusal('observer', 'findings')).toMatch(/may not read "findings".*root.*research.*development/s);
    expect(a.decideRefusal('coder', 'findings')).toMatch(/only dev-lead \(lead of development\), qa-lead \(lead of qa\) decide/);
  });
});
