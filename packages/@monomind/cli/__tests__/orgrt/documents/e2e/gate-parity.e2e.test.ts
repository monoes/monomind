// P3.14 scenarios 7, 8 and 9 in the same daemon and on the same miniature roster.
//  7. The eval gate: a sections org cannot start without it, starts with it, and a boss crash stops it with
//     closedBy eval-boss-crash instead of restarting it.
//  8. Sections-off parity: the same roster and roles WITHOUT sections have no docs directory, no org_doc_* tool,
//     no notice, no runtime sender, no new bus reason (judged against the P3.0 sections-off bus golden), prompts
//     that differ from the sections-on prompts by the guidance block alone, and an org_send that is unchanged.
//     The sections-off golden suite itself (sections-off-golden.test.ts, the four SHAs) runs untouched.
//  9. Prompts: each sections-on role's captured system prompt carries its guidance block; a sections-off role's
//     does not.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../src/orgrt/types.js';
import { documentGuidance } from '../../../../src/orgrt/documents/guidance.js';
import { EVAL_BOSS_CRASH_CLOSED_BY, evalGateRefusal } from '../../../../src/orgrt/documents/eval-gate.js';
import { normalizeString } from '../../support/normalize-golden.js';
import { miniOrg } from './mini-org.js';
import { Scripted, useWorld, waitFor } from './scripted.js';

const world = useWorld('e2e-gate');
const ROLES = ['lead', 'worker-1', 'worker-2', 'worker-3', 'synthesiser', 'observer'];

async function startAll(raw: Record<string, any>) {
  const runner = new Scripted();
  const s = await world.start(raw, { runner });
  const tools: Record<string, string[]> = {};
  const sends: Record<string, string> = {};
  for (const r of ROLES) {
    const t = await runner.toolsOf(s.d, s.name, r);
    tools[r] = t.map((x) => x.name);
    sends[r] = t.find((x) => x.name === 'org_send')?.description ?? '';
  }
  return { ...s, runner, tools, sends };
}

describe('the eval gate and closedBy', () => {
  it('a sections org cannot start without the gate; with it, it starts', async () => {
    await expect(world.start(miniOrg(), { evalGate: false })).rejects.toThrow(evalGateRefusal('mini-sweep'));
    const s = await world.start(miniOrg());
    expect(s.d.getOrg('mini-sweep')).toBeDefined();
    expect(s.docs.dir).toBe(join(world.root, '.monomind/orgs/mini-sweep/docs', s.running.run));
  });

  it('a boss crash stops a sections org with closedBy eval-boss-crash and no restart', async () => {
    const runner = new Scripted();
    runner.crash.add('lead'); // the coordinator's session dies the moment it starts
    const s = await world.start(miniOrg(), { runner, daemonOpts: { crashBackoffsMs: [] } });
    const runtimeFile = join(world.root, '.monomind/orgs/mini-sweep/runtime.json');
    const stopped = (): boolean => {
      try {
        return JSON.parse(readFileSync(runtimeFile, 'utf8')).status === 'stopped';
      } catch {
        return false;
      }
    };
    // the org leaves the daemon's table and the stop is persisted by separate steps: wait for both
    expect(await waitFor(() => s.d.getOrg('mini-sweep') === undefined && stopped())).toBe(true);
    const events = s.running.busEvents();
    expect(events.find((e) => e.reason === 'org-stopped')?.data?.closedBy).toBe(EVAL_BOSS_CRASH_CLOSED_BY);
    expect(events.some((e) => e.reason === 'boss-restart')).toBe(false);
    expect(events.some((e) => e.reason === EVAL_BOSS_CRASH_CLOSED_BY)).toBe(true);
    const rt = JSON.parse(readFileSync(runtimeFile, 'utf8'));
    expect(rt).toMatchObject({ status: 'stopped', closedBy: 'eval-boss-crash' });
    expect(s.docs.closed).toBe(true); // the documents runtime was closed with the run
  });
});

describe('sections-off parity on the same roster', () => {
  it('has no docs directory, no org_doc_* tool, no notice, no runtime sender and no new bus reason', async () => {
    const off = await startAll(miniOrg({ sectionsOff: true, observer: true }));
    expect(off.running.documents).toBeUndefined();
    expect(existsSync(join(world.root, '.monomind/orgs/mini-sweep/docs'))).toBe(false);
    expect(readdirSync(join(world.root, '.monomind/orgs/mini-sweep')).includes('docs')).toBe(false);
    for (const r of ROLES) {
      expect(off.tools[r].filter((n) => n.startsWith('org_doc')), r).toEqual([]);
      expect(off.sends[r], r).not.toMatch(/org_doc/);
    }
    // the same traffic that a sections org would refuse or notify about: nothing refused, nothing sent by the runtime
    expect(await off.d.deliver(off.name, 'worker-1', 'worker-2', 's', 'hello across')).toBe('delivered to worker-2');
    expect(await off.d.deliver(off.name, 'worker-1', 'synthesiser', 's', 'hello consumer')).toBe('delivered to synthesiser');
    expect(await waitFor(() => off.runner.subjects('synthesiser').includes('s'))).toBe(true);
    for (const t of off.runner.allTexts()) expect(t).not.toContain('[message from org-docs]');
    // no bus reason beyond the P3.0 sections-off golden's, and none of the documents' or the gate's
    // (the scripted AgentRunner is not the Claude runtime, so the git sandbox audit it triggers is not in that golden)
    const golden = new Set<string>(['git-sandbox-unsupported-runtime']);
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        if (typeof o.reason === 'string') golden.add(o.reason);
        Object.values(o).forEach(walk);
      }
    };
    walk(JSON.parse(readFileSync(join(__dirname, '../../fixtures/sections-off/run-bus.json'), 'utf8')));
    const reasons = new Set(off.running.busEvents().map((e) => e.reason).filter((r): r is string => typeof r === 'string'));
    expect([...reasons].filter((r) => !golden.has(r))).toEqual([]);
    expect([...reasons].filter((r) => /^doc-|cross-section|eval-boss/.test(r))).toEqual([]);
    expect(off.running.busEvents().some((e) => e.from === 'org-docs')).toBe(false);
  });

  it('sections-on prompts differ from sections-off prompts by the guidance block alone, per role (scenario 9)', async () => {
    const onRaw = miniOrg({ observer: true });
    const on = await startAll(onRaw);
    const onPrompts = Object.fromEntries(ROLES.map((r) => [r, normalizeString(on.runner.systemPrompts.get(r) as string, { roots: [world.root] })]));
    const def = OrgDefSchema.parse(onRaw);
    await on.d.stopAll();
    const off = await startAll(miniOrg({ sectionsOff: true, observer: true }));
    for (const r of ROLES) {
      const offPrompt = normalizeString(off.runner.systemPrompts.get(r) as string, { roots: [world.root] });
      const block = documentGuidance(def, r);
      expect(typeof block, r).toBe('string'); // every role of a sections org gets its own block
      // scenario 9: the guidance block is in each sections-on role's real prompt, and not in a sections-off one
      expect(onPrompts[r], r).toContain(block as string);
      expect(onPrompts[r], r).toContain('Documents between sections');
      expect(offPrompt, r).not.toContain('Documents between sections');
      expect(offPrompt, r).not.toMatch(/org_doc_/);
      // and apart from the block the two are byte for byte the same
      expect(onPrompts[r].replace(`\n\n${block}`, ''), r).toBe(offPrompt);
    }
    // the tool lists differ by the document tools alone, in the same order; org_send alone gains a sentence
    for (const r of ROLES) {
      expect(on.tools[r].filter((n) => !n.startsWith('org_doc')), r).toEqual(off.tools[r]);
      expect(on.tools[r].filter((n) => n.startsWith('org_doc')), r).toEqual(['org_doc_list', 'org_doc_read', 'org_doc_publish', 'org_doc_decide', 'org_doc_check']);
      expect(on.sends[r].startsWith(off.sends[r]), r).toBe(true);
    }
  });

  it('the guidance block of each role names only tools that role has', async () => {
    const onRaw = miniOrg({ observer: true });
    const on = await startAll(onRaw);
    for (const r of ROLES) {
      const prompt = on.runner.systemPrompts.get(r) as string;
      for (const name of new Set(prompt.match(/org_doc_[a-z]+/g) ?? [])) expect(on.tools[r], `${r} is told about ${name}`).toContain(name);
    }
  });
});
