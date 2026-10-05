// P4.12 scenario G: parity. A sections-off org and a Phase 3 sections-on org that sets none of the Phase 4 keys behave in
// the same daemon exactly as the Phase 3 suites pin them: the miniature sweep's full trail equals the P3.14 golden
// (read here, never written), its prompts equal the P3.12 goldens, its engines are the plain ones and nothing of the Phase 4
// machinery exists for it; a sections-off org started next to it carries no Phase 4 text. In a Phase 4 org each role's prompt
// holds its Phase 4 lines and only those (the same org with other key values differs by those lines alone). The deferred
// table of 13.2.1 still fails at start with "not yet supported".
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../../src/orgrt/daemon.js';
import { documentGuidance } from '../../../../src/orgrt/documents/guidance.js';
import { PolicyEngine } from '../../../../src/orgrt/policy.js';
import { OrgDefSchema } from '../../../../src/orgrt/types.js';
import { findingsOrg } from '../../support/doc-defs.js';
import { CaptureRunner } from '../../support/doc-runner.js';
import { normalizeString } from '../../support/normalize-golden.js';
import { KEY_SETS, ROLES, phase4Org } from '../../support/phase4-guidance-defs.js';
import { Cast } from '../e2e/cast.js';
import { MINI_DOCS, miniOrg } from '../e2e/mini-org.js';
import { Scripted, useWorld, waitFor } from '../e2e/scripted.js';
import { trailOf } from '../e2e/trail.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');
const golden = (rel: string): any => JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));
const world = useWorld('p4-parity');
const PHASE4_TEXT = /Rework cap|USD allocation|only writer|owns writes to the workspace|Section allocations|As section lead you assign/;

describe('the Phase 3 sweep and a sections-off org in one daemon', () => {
  it('the miniature sweep without Phase 4 keys produces the P3.14 trail golden; a sections-off org started in the same daemon has no documents and no Phase 4 text', async () => {
    const runner = new Scripted();
    const started = await world.start(miniOrg(), { runner });
    const { d, name, docs, running } = started;
    const [W1, W2] = MINI_DOCS;
    const { duplicatedSheet, honest, reversedFiles, wrongValue } = await import('../e2e/mini-org.js');
    const cast = new Cast(world.root, {
      [W1]: { work: [{ body: wrongValue(W1) }], relay: [{ body: reversedFiles(W1) }] },
      [W2]: { work: [{ body: duplicatedSheet(W2), files: honest(W2) }, { body: duplicatedSheet(W2) }] },
    })
      .bind(() => docs.store)
      .install(runner);
    await runner.toolsOf(d, name, 'synthesiser', 'brief: sheets will come, process each when it is published');
    await Cast.assign(d, name);
    expect(await waitFor(() => cast.synthesis !== undefined, 15000)).toBe(true);
    await docs.notices!.idle();
    const copies = () => runner.subjects('lead').filter((s) => s.endsWith('(copy)'));
    expect(await waitFor(() => copies().length === 3)).toBe(true);
    await docs.notices!.idle();
    expect(runner.errors).toEqual([]);
    // the same trail the Phase 3 suite pins (fixtures/sections-on/e2e-sweep-trail.json), read-only here
    const trail = JSON.parse(JSON.stringify(trailOf({ root: world.root, running, docs, runner, cast })));
    expect(trail).toEqual(golden('sections-on/e2e-sweep-trail.json'));
    // nothing of Phase 4 exists for this org: plain engines, no caps, no budget state, no rework machinery
    for (const r of running.def.roles) {
      const engine = running.agents.get(r.id)?.policy;
      if (!engine) continue;
      expect(engine.constructor, r.id).toBe(PolicyEngine);
      expect(engine.policy.maxUsd, r.id).toBeUndefined();
      expect(engine.policy.fileWrite, r.id).toEqual(['**']);
    }
    expect(docs.reworkReport()).toEqual([]);
    expect(running.busEvents().filter((e) => /^section-budget|^writer-|rework/.test(e.reason ?? ''))).toEqual([]);
    for (const t of runner.allTexts()) expect(t).not.toMatch(/rework exhausted|budget:/);

    // a sections-off org of the same roster started in the same daemon, after the sweep
    const offRaw = { ...miniOrg({ sectionsOff: true, observer: true }), name: 'mini-off' };
    world.write(offRaw);
    runner.tools.clear(); // the roster has the same role ids: capture the sections-off sessions afresh
    runner.systemPrompts.clear();
    const off = await d.startOrg('mini-off', undefined, {});
    expect(off.documents).toBeUndefined();
    expect(existsSync(join(world.root, '.monomind/orgs/mini-off/docs'))).toBe(false);
    for (const r of ['lead', 'worker-1', 'observer']) await runner.toolsOf(d, 'mini-off', r, 'hello off');
    for (const r of ['lead', 'worker-1', 'observer']) {
      const prompt = runner.systemPrompts.get(r) as string;
      expect(prompt, r).not.toContain('Documents between sections');
      expect(prompt, r).not.toMatch(PHASE4_TEXT);
      expect(off.agents.get(r)!.policy.constructor, r).toBe(PolicyEngine);
    }
    expect(off.busEvents().some((e) => e.from === 'org-docs')).toBe(false);
    expect(d.getOrg(name)).toBeDefined(); // and the sections org is still running beside it
  }, 60_000);
});

describe('a Phase 3 sections-on org with no Phase 4 key', () => {
  const daemons: OrgDaemon[] = [];
  let root = '';
  const saved = { ...process.env };
  afterEach(async () => {
    await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
    if (root) rmSync(root, { recursive: true, force: true });
    for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
  });

  /** The normalised system prompt of each of `roles` of `raw`, started through a real OrgDaemon. */
  async function promptsOf(raw: Record<string, any>, roles: readonly string[]): Promise<Record<string, string>> {
    process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
    process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
    root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'p4-parity-prompts-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
    const runner = new CaptureRunner();
    const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    daemons.push(d);
    await d.startOrg(raw.name, undefined, { evalGate: true });
    const out: Record<string, string> = {};
    for (const r of roles) {
      await runner.toolsOf(d, raw.name, r);
      out[r] = normalizeString(runner.systemPrompts.get(r) as string, { roots: [root] });
    }
    await d.stopAll();
    rmSync(root, { recursive: true, force: true });
    return out;
  }

  it('starts every role with the P3.12 prompt, byte for byte, and no Phase 4 line', async () => {
    const p312 = golden('sections-on/prompts.json') as Record<string, string>;
    const got = await promptsOf(findingsOrg(), Object.keys(p312));
    expect(got).toEqual(p312);
    for (const r of Object.keys(p312)) expect(got[r], r).not.toMatch(PHASE4_TEXT);
  });

  it('a Phase 4 org: each role\'s prompt holds its Phase 4 lines, and the same org with other key values differs by those lines alone', async () => {
    const all = { ...phase4Org(KEY_SETS.all), name: 'p4-parity' };
    // other values for the same keys, still a valid partition (the root reserve keeps boss): 40 for development, 110 for the org
    const variant = phase4Org(KEY_SETS.all);
    variant.name = 'p4-parity';
    variant.sections.development.budget = { usd: 40 };
    variant.run_config.budget_usd = 110;
    variant.sections.qa.max_rework_rounds = 7;
    variant.sections.development.writes = ['lib/**'];
    const [a, b] = [await promptsOf(all, ROLES), await promptsOf(variant, ROLES)];
    const blockOf = (raw: Record<string, any>, r: string) => documentGuidance(OrgDefSchema.parse(raw), r) as string;
    const baseOf = (raw: Record<string, any>, r: string) =>
      documentGuidance(OrgDefSchema.parse({ ...phase4Org(KEY_SETS.none), name: raw.name }), r) as string;
    const added: Record<string, number> = {};
    for (const r of ROLES) {
      const blockA = blockOf(all, r);
      const blockB = blockOf(variant, r);
      const base = baseOf(all, r);
      // the P3.12 text of the topology comes first and is unchanged; the Phase 4 lines follow it
      expect(blockA.startsWith(base), r).toBe(true);
      expect(a[r], r).toContain(blockA);
      expect(a[r].split(blockA), r).toHaveLength(2); // exactly once
      added[r] = blockA.slice(base.length).split('\n').filter(Boolean).length;
      // everything outside the block is the same whatever the key values are
      expect(a[r].replace(blockA, ''), r).toBe(b[r].replace(blockB, ''));
      // another role's lines are not in this role's prompt
      for (const other of ROLES.filter((x) => x !== r))
        for (const line of blockOf(all, other).slice(baseOf(all, other).length).split('\n').filter(Boolean))
          if (!blockA.includes(line)) expect(a[r], `${r} must not carry a line of ${other}: ${line.slice(0, 50)}`).not.toContain(line);
    }
    expect(added).toEqual({ boss: 4, 'dev-lead': 7, coder: 5, 'qa-lead': 7, observer: 4 });
    expect(blockOf(variant, 'dev-lead')).not.toBe(blockOf(all, 'dev-lead')); // the lines follow the keys
  }, 60_000);
});

describe('the deferred table of 13.2.1 still fails at start with "not yet supported"', () => {
  const cases: Array<[string, (r: Record<string, any>) => void, RegExp]> = [
    ['run_config.max_turn_usd', (r) => (r.run_config.max_turn_usd = 1), /run_config\.max_turn_usd: max_turn_usd is not yet supported/],
    ['run_config.allow_unbounded_turn', (r) => (r.run_config.allow_unbounded_turn = true), /allow_unbounded_turn is not yet supported/],
    ['run_config.budget_mode strict', (r) => (r.run_config.budget_mode = 'strict'), /run_config\.budget_mode: "strict" is not yet supported/],
    ['a token partition in a section budget', (r) => (r.sections.development.budget = { usd: 30, tokens: 5 }), /sections\.development\.budget: "tokens" is not yet supported/],
    ['sections.<s>.parallelism.max_depth', (r) => (r.sections.development.parallelism = { max_depth: 2 }), /parallelism\.max_depth: not yet supported/],
    ['sections.<s>.mode deliberative', (r) => (r.sections.development.mode = 'deliberative'), /"deliberative" is not yet supported/],
    ['sections.<s>.requests direct', (r) => (r.sections.development.requests = 'direct'), /"direct" is not yet supported/],
  ];
  for (const [label, edit, pattern] of cases)
    it(`still refused: ${label}`, async () => {
      const raw = phase4Org(KEY_SETS.budget);
      raw.name = 'deferred-e2e';
      edit(raw);
      await expect(world.start(raw)).rejects.toThrow(pattern);
    });

  it('run_config.budget_usd outside the sections surface fails', async () => {
    const plainOrg = (extra: Record<string, any>) => {
      const raw = phase4Org(KEY_SETS.all);
      for (const k of ['sections', 'documents', 'requires']) delete raw[k];
      delete raw.run_config.experimental;
      delete raw.run_config.completion;
      raw.name = 'deferred-off';
      return Object.assign(raw, extra);
    };
    const withBudget = plainOrg({});
    withBudget.run_config.budget_usd = 5;
    await expect(world.start(withBudget, { evalGate: false })).rejects.toThrow(/run_config\.budget_usd is not yet supported/);
  });
});
