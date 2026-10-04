// P3.12: the real system prompt of a role, captured by a scripted runner in a real OrgDaemon (no model): a
// sections-ON role has the block, a sections-off role of the same org shape has not, and apart from the block
// the two prompts are byte for byte the same. Also the prompt-cache note: an org that adopts sections starts a
// new prefix once; a sections-off org never does.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import { documentGuidance } from '../../../src/orgrt/documents/guidance.js';
import { OrgDefSchema } from '../../../src/orgrt/types.js';
import { CaptureRunner } from '../support/doc-runner.js';
import { findingsOrg } from '../support/doc-defs.js';

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'guidance-daemon-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

const ROLES = ['boss', 'researcher', 'dev-lead', 'coder', 'observer'];

/** Start `raw` and return the system prompt each of ROLES was started with. */
async function promptsOf(raw: Record<string, any>): Promise<Record<string, string>> {
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new CaptureRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  await d.startOrg(raw.name, undefined, raw.sections ? { evalGate: true } : {});
  const out: Record<string, string> = {};
  for (const r of ROLES) {
    await runner.toolsOf(d, raw.name, r);
    out[r] = runner.systemPrompts.get(r) as string;
  }
  await d.stopAll();
  return out;
}

/** The same org with every sections key removed: a plain org. */
function sectionsOff(raw: Record<string, any>): Record<string, any> {
  const { sections, documents, requires, ...rest } = raw;
  const { experimental, completion, ...runConfig } = rest.run_config;
  return { ...rest, run_config: runConfig };
}

describe('the system prompt a role is started with', () => {
  it('sections ON: the block is in the real prompt; sections off: it is not, and nothing else differs', async () => {
    const raw = findingsOrg();
    const on = await promptsOf(raw);
    const off = await promptsOf(sectionsOff(raw));
    const def = OrgDefSchema.parse(raw);
    for (const r of ROLES) {
      const block = documentGuidance(def, r) as string;
      expect(on[r], r).toContain(block);
      expect(off[r], r).not.toContain('Documents between sections');
      expect(off[r], r).not.toMatch(/org_doc_/);
      expect(on[r].replace(`\n\n${block}`, ''), r).toBe(off[r]);
    }
  });

  it('the cost of adopting sections is the block alone, per role', async () => {
    const raw = findingsOrg();
    const on = await promptsOf(raw);
    const off = await promptsOf(sectionsOff(raw));
    const def = OrgDefSchema.parse(raw);
    for (const r of ROLES) {
      const added = Buffer.byteLength(on[r]) - Buffer.byteLength(off[r]);
      expect(added, r).toBe(Buffer.byteLength(`\n\n${documentGuidance(def, r)}`));
      expect(added, r).toBeLessThan(4000);
    }
  });

  it('a second run of the same sections org starts with the same bytes (the prefix is stable, so it caches)', async () => {
    const raw = findingsOrg();
    expect(await promptsOf(raw)).toEqual(await promptsOf(raw));
  });
});
