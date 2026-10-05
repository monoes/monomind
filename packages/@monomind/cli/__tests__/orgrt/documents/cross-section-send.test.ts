// packages/@monomind/cli/__tests__/orgrt/documents/cross-section-send.test.ts
// P3.7: the cross-section org_send refusal on the shared deliver path. Pure matrix, refusal text,
// bus event shape, sections-off orgs unchanged, the real daemon (no model), the org_send tool
// result, and parity with the pilot's routing refusal (tests/eval/org/pilot/routing.ts).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import {
  crossSectionRefusal,
  crossSectionRefusalText,
  sectionOf,
} from '../../../src/orgrt/documents/routing.js';
import { buildOrgTools } from '../../../src/orgrt/org-tools.js';
import { crossSectionRefusal as pilotRefusal } from '../../../../../../tests/eval/org/pilot/routing.js';
import { sectionsRaw } from '../support/sections-defs.js';

// sec-org: boss (root); research = research-lead + researcher; development = dev-lead + coder;
// `observer` reports to boss and is alone in section `watch` (every non-root role is in exactly one section).
const def = (): any =>
  sectionsRaw((raw) => {
    raw.run_config.max_concurrent_agents = 6; // P4.9: six agent roles must fit
    raw.roles.push({
      id: 'observer',
      title: 'observer',
      type: 'specialist',
      reports_to: 'boss',
      responsibilities: ['watch'],
      policy: { sandbox: { mode: 'off' } },
    });
    raw.sections.watch = { members: ['observer'] };
  });

const refusalOf = (from: string, to: string): string | undefined => crossSectionRefusal(def(), from, to);

describe('sectionOf', () => {
  it('finds a role by lead or member, and nothing for the root and unknown roles', () => {
    expect(sectionOf(def(), 'research-lead')).toBe('research');
    expect(sectionOf(def(), 'researcher')).toBe('research');
    expect(sectionOf(def(), 'coder')).toBe('development');
    expect(sectionOf(def(), 'boss')).toBeUndefined();
    expect(sectionOf(def(), 'observer')).toBe('watch');
    expect(sectionOf(def(), 'nobody')).toBeUndefined();
    expect(sectionOf({ sections: undefined }, 'coder')).toBeUndefined();
  });
});

describe('crossSectionRefusal matrix (sections org)', () => {
  it('allows a send within one section, in both directions, to and from the lead', () => {
    expect(refusalOf('researcher', 'research-lead')).toBeUndefined();
    expect(refusalOf('research-lead', 'researcher')).toBeUndefined();
    expect(refusalOf('coder', 'dev-lead')).toBeUndefined();
    expect(refusalOf('researcher', 'researcher')).toBeUndefined();
  });

  it('refuses a send between different sections: member, lead, and mixed', () => {
    expect(refusalOf('researcher', 'coder')).toBe(crossSectionRefusalText('researcher', 'research', 'coder', 'development'));
    expect(refusalOf('coder', 'researcher')).toBe(crossSectionRefusalText('coder', 'development', 'researcher', 'research'));
    expect(refusalOf('research-lead', 'dev-lead')).toBe(
      crossSectionRefusalText('research-lead', 'research', 'dev-lead', 'development'),
    );
    expect(refusalOf('researcher', 'dev-lead')).toMatch(/^REFUSED:/);
    expect(refusalOf('dev-lead', 'researcher')).toMatch(/^REFUSED:/);
  });

  it('never refuses the root, as sender or as target', () => {
    for (const r of ['researcher', 'research-lead', 'coder', 'dev-lead']) {
      expect(refusalOf('boss', r)).toBeUndefined();
      expect(refusalOf(r, 'boss')).toBeUndefined();
    }
  });

  it('never refuses the human or the runtime sender org-docs', () => {
    for (const from of ['human', 'org-docs']) {
      expect(refusalOf(from, 'coder')).toBeUndefined();
      expect(refusalOf(from, 'research-lead')).toBeUndefined();
    }
  });

  it('does not exempt a real role that happens to carry a runtime sender name', () => {
    const raw = def();
    raw.roles.push({ id: 'org-docs', title: 'x', type: 'specialist', reports_to: 'boss' });
    raw.sections.research.members.push('org-docs');
    expect(crossSectionRefusal(raw, 'org-docs', 'coder')).toMatch(/^REFUSED:/);
  });

  it('binds every non-root role the same way (one predicate: different sections, neither the root nor a runtime sender)', () => {
    expect(refusalOf('observer', 'coder')).toBe(crossSectionRefusalText('observer', 'watch', 'coder', 'development'));
    expect(refusalOf('coder', 'observer')).toBe(crossSectionRefusalText('coder', 'development', 'observer', 'watch'));
    expect(refusalOf('observer', 'observer')).toBeUndefined();
  });

  it('leaves an unknown target to the deliver path, which says so', () => {
    expect(refusalOf('researcher', 'nobody')).toBeUndefined();
  });

  it('is off for an org without sections, and for a definition with an empty sections object', () => {
    const noSections = def();
    delete noSections.sections;
    expect(crossSectionRefusal(noSections, 'researcher', 'coder')).toBeUndefined();
    expect(crossSectionRefusal({ ...def(), sections: {} }, 'researcher', 'coder')).toBeUndefined();
  });

  it('has the exact refusal text, naming the rule and the legitimate routes', () => {
    expect(refusalOf('researcher', 'coder')).toBe(
      'REFUSED: researcher (section research) cannot message coder (section development). Sections hand work over through documents: publish it with org_doc_publish, or raise it with the root, who can reach any section.',
    );
  });
});

describe('parity with the pilot routing refusal (sweep-3 map)', () => {
  const pilot = JSON.parse(
    readFileSync(join(__dirname, '../../../../../../tests/eval/org/pilot/parallel-sweep-3.pilot.json'), 'utf8'),
  );
  const routing = pilot.routing as { sections: Record<string, { lead: string; members: string[] }> };
  const sectioned = Object.values(routing.sections).flatMap((s) => [s.lead, ...s.members]);
  const roles = ['lead', ...sectioned].map((id) => ({
    id,
    type: id === 'lead' ? 'boss' : 'specialist',
    reports_to: id === 'lead' ? null : 'lead',
  }));
  const d = { sections: routing.sections, roles };

  it('decides every ordered pair of the roster like the pilot, and refuses the same cross-section pairs', () => {
    const ids = roles.map((r) => r.id);
    let refused = 0;
    for (const from of ids)
      for (const to of ids) {
        const mine = crossSectionRefusal(d, from, to);
        const theirs = pilotRefusal(routing, from, to);
        expect(mine === undefined, `${from} -> ${to}`).toBe(theirs === undefined);
        if (mine) refused++;
      }
    // 9 sectioned roles in 5 sections (four of two, one of one): all ordered pairs minus the in-section ones.
    expect(refused).toBe(9 * 8 - 4 * 2);
  });

  it('refuses a worker messaging the synthesiser and another worker, allows the lead (root) and the same section', () => {
    expect(crossSectionRefusal(d, 'worker-2', 'synthesiser')).toMatch(/^REFUSED:/);
    expect(crossSectionRefusal(d, 'worker-2', 'worker-3')).toMatch(/^REFUSED:/);
    expect(crossSectionRefusal(d, 'worker-2', 'lead')).toBeUndefined();
    expect(crossSectionRefusal(d, 'worker-2', 'worker-1')).toBeUndefined();
  });
});

// ---------- the real daemon: the real deliver path ----------

const queryFn = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

let root: string;
const daemons: OrgDaemon[] = [];
const start = async (raw: Record<string, any>, opts: Record<string, unknown> = {}) => {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, ...opts });
  daemons.push(d);
  const running = await d.startOrg(raw.name, undefined, raw.sections ? { evalGate: true } : undefined);
  return { d, running };
};

beforeEach(() => {
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'cross-section-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((x) => x.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
});

describe('through the real daemon deliver path', () => {
  it('refuses a cross-section send: receipt, bus audit event shape, nothing queued for the target', async () => {
    const { d, running } = await start(def());
    const receipt = await d.deliver('sec-org', 'researcher', 'coder', 'hello', 'secret plans');
    expect(receipt).toBe(crossSectionRefusalText('researcher', 'research', 'coder', 'development'));
    const ev = running.busEvents().filter((e) => e.reason === 'cross-section-refused');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({
      type: 'audit',
      from: 'researcher',
      to: 'coder',
      subject: 'hello',
      msg: receipt,
      reason: 'cross-section-refused',
    });
    expect(typeof ev[0].data?.messageId).toBe('string');
    expect(running.busEvents().some((e) => e.type === 'message' && e.to === 'coder' && e.from === 'researcher')).toBe(false);
    expect(running.agents.get('coder')?.mailbox.peek() ?? '').not.toContain('secret plans');
  });

  it('delivers inside a section, from the root and from the human', async () => {
    const { d, running } = await start(def());
    expect(await d.deliver('sec-org', 'researcher', 'research-lead', 's', 'b')).toBe('delivered to research-lead');
    expect(await d.deliver('sec-org', 'boss', 'coder', 's', 'b')).toBe('delivered to coder');
    expect(await d.deliver('sec-org', 'human', 'coder', 's', 'b')).toBe('delivered to coder');
    expect(running.busEvents().some((e) => e.reason === 'cross-section-refused')).toBe(false);
  });

  it('leaves a cross-org target untouched (the section check is for local sends)', async () => {
    const { d, running } = await start(def());
    const receipt = await d.deliver('sec-org', 'researcher', 'other-org:coder', 's', 'b');
    expect(receipt).not.toMatch(/^REFUSED: researcher \(section/);
    expect(running.busEvents().some((e) => e.reason === 'cross-section-refused')).toBe(false);
  });

  it('an org without sections delivers the same pair, with no new event', async () => {
    const raw = def();
    delete raw.sections;
    delete raw.documents;
    delete raw.requires;
    delete raw.run_config.experimental;
    delete raw.run_config.completion;
    const { d, running } = await start(raw);
    expect(await d.deliver('sec-org', 'researcher', 'coder', 's', 'b')).toBe('delivered to coder');
    expect(running.busEvents().some((e) => e.reason === 'cross-section-refused')).toBe(false);
  });

  it('reaches the model as the org_send tool result, not an exception, with the same description as a sections-off org', async () => {
    const { d, running } = await start(def());
    const role = running.def.roles.find((r) => r.id === 'researcher')!;
    const mk = (defn: any) =>
      buildOrgTools({
        role,
        def: defn,
        cwd: root,
        deliver: (from: string, to: string, subject: string, body: string) =>
          d.deliver('sec-org', from, to, subject, body),
      } as any).find((t) => t.name === 'org_send')!;
    const send = mk(running.def);
    const out = await send.handler({ to: 'coder', subject: 'hi', message: 'x' });
    expect(out).toEqual({
      text: crossSectionRefusalText('researcher', 'research', 'coder', 'development'),
    });
    const ok = await send.handler({ to: 'research-lead', subject: 'hi', message: 'x' });
    expect(ok).toEqual({ text: 'delivered to research-lead' });
    const off = { ...running.def, sections: undefined };
    expect(mk(off).description).toBe(send.description);
  });
});
