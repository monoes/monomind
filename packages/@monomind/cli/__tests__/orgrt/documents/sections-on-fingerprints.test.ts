// P3.12: the sections-ON fingerprints. The one piece that changes prompt bytes (13.1.5), and only for an org that
// is on the sections surface and has a documents runtime. Pinned here, in a file of their own:
//  - the system prompt each kind of role is started with, through a real OrgDaemon and a scripted runner (no
//    model): its sha, its text in fixtures/sections-on/prompts.json (normalised like the P3.0 goldens), and
//  - the text of org_send and of the five org_doc_* tools as a sections-on session lists them
//    (fixtures/sections-on/tool-descriptions.json).
// The sections-OFF goldens (fixtures/sections-off/, the four SHAs of org-loadouts-default-off.test.ts and their
// tripwire copy) are NOT touched by this piece; it proves them unchanged by leaving them as they were.
//
// Deliberate recapture, only for an intentional change to the role text or to those descriptions:
//   SECTIONS_ON_GOLDEN_UPDATE=P3.12 npx vitest run __tests__/orgrt/documents/sections-on-fingerprints.test.ts
// rewrites the two fixtures; then re-pin the shas below and the tool-list shas in documents-wiring.test.ts and
// documents-check-wiring.test.ts in the same commit, with the reason. Review the fixture diff line by line.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import type { DocumentToolHost } from '../../../src/orgrt/documents/runtime.js';
import { buildOrgTools } from '../../../src/orgrt/org-tools.js';
import type { SessionOpts } from '../../../src/orgrt/session-types.js';
import { CaptureRunner } from '../support/doc-runner.js';
import { findingsOrg } from '../support/doc-defs.js';
import { normalizeString } from '../support/normalize-golden.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'sections-on');
const UPDATE = process.env.SECTIONS_ON_GOLDEN_UPDATE === 'P3.12';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

// Captured when P3.12 landed (the role text of guidance.ts). One per kind of role of the synthetic org below.
const SECTIONS_ON_PRODUCER_PROMPT_SHA = '59e3661988c552a365109e7d57740de83644f00329ad335e23e2a3502916d69d';
const SECTIONS_ON_CONSUMER_LEAD_PROMPT_SHA = 'aa89cd148a4f0b2017990f8b3cb9f7ea044b642a46eb7cfb670e41b02925d9c9';
const SECTIONS_ON_ROOT_PROMPT_SHA = '413bcc92ff9b931d5d2b0f87ddcdcc63a8fce9576dbaf899b737e93cd2d26601';
const SECTIONS_ON_UNSECTIONED_PROMPT_SHA = '030cd4788cb0cf4245929a643f905bce4e58af159722866289abb91c0f5630e5';
const PROMPT_SHAS: Record<string, string> = {
  researcher: SECTIONS_ON_PRODUCER_PROMPT_SHA,
  'dev-lead': SECTIONS_ON_CONSUMER_LEAD_PROMPT_SHA,
  boss: SECTIONS_ON_ROOT_PROMPT_SHA,
  observer: SECTIONS_ON_UNSECTIONED_PROMPT_SHA,
};

function golden(name: string, actual: unknown): void {
  const file = join(FIXTURES, `${name}.json`);
  const got = JSON.parse(JSON.stringify(actual)) as unknown;
  if (UPDATE) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    return;
  }
  if (!existsSync(file)) throw new Error(`sections-on golden "${name}" is missing; fixtures are committed`);
  expect(got).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

let root: string;
const daemons: OrgDaemon[] = [];
const saved = { ...process.env };
beforeEach(() => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'sections-on-fp-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
});
afterEach(async () => {
  await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
  rmSync(root, { recursive: true, force: true });
  for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
});

async function prompts(): Promise<Record<string, string>> {
  const raw = findingsOrg();
  writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
  const runner = new CaptureRunner();
  const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
  daemons.push(d);
  await d.startOrg(raw.name, undefined, { evalGate: true });
  const out: Record<string, string> = {};
  for (const role of Object.keys(PROMPT_SHAS)) {
    await runner.toolsOf(d, raw.name, role);
    out[role] = normalizeString(runner.systemPrompts.get(role) as string, { roots: [root] });
  }
  return out;
}

describe('sections-ON system prompts (through a real daemon, scripted runner)', () => {
  it('the prompt of each kind of role is pinned by sha and by text', async () => {
    const got = await prompts();
    golden('prompts', got);
    if (UPDATE) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, sha(v)])), null, 1));
      return;
    }
    for (const [role, expected] of Object.entries(PROMPT_SHAS)) expect(sha(got[role]), role).toBe(expected);
  });

  it('only the producer, the consumer lead and the root carry duties; every role carries the block header', async () => {
    const got = await prompts();
    for (const t of Object.values(got)) expect(t).toContain('## Documents between sections');
    expect(got.researcher).toContain('You publish:');
    expect(got['dev-lead']).toContain('You decide for section "development"');
    expect(got.boss).toContain('You are the root');
    expect(got.observer).toContain('You are in no section.');
  });
});

describe('sections-ON tool descriptions', () => {
  const host = {
    role: 'researcher',
    list: () => ({ ok: true }),
    read: () => ({ ok: true }),
    publish: () => ({ ok: true }),
    decide: () => ({ ok: true }),
    check: () => ({ ok: true }),
  } as unknown as DocumentToolHost;
  const def = JSON.parse(JSON.stringify(findingsOrg()));
  const tools = (documents?: DocumentToolHost) =>
    buildOrgTools({
      org: def.name,
      role: def.roles[2],
      def,
      cwd: '/work',
      deliver: async () => 'ok',
      ...(documents ? { documents } : {}),
    } as unknown as SessionOpts);
  const describe_ = (documents?: DocumentToolHost): Record<string, string> =>
    Object.fromEntries(
      tools(documents)
        .filter((t) => t.name === 'org_send' || t.name.startsWith('org_doc_'))
        .map((t) => [t.name, t.description]),
    );

  it('org_send and the five org_doc_* descriptions are pinned', () => {
    golden('tool-descriptions', describe_(host));
  });

  it('org_send changes only by the appended sentence, and only with a documents host', () => {
    const off = describe_().org_send;
    const on = describe_(host).org_send;
    expect(on.startsWith(off)).toBe(true);
    expect(on.slice(off.length)).toMatch(/^ In an org with sections, a message to a role in another section is refused/);
    expect(off).not.toMatch(/sections/);
  });

  it('the tools say to verify files before publishing, what decide means, and what a check does not prove', () => {
    const d = describe_(host);
    expect(d.org_doc_publish).toMatch(/verify them on disk/);
    expect(d.org_doc_publish).toMatch(/uses one of the limited attempts/);
    expect(d.org_doc_decide).toMatch(/Accept means you rely on that exact version/);
    expect(d.org_doc_decide).toMatch(/A decision is per version/);
    expect(d.org_doc_check).toMatch(/necessary, not sufficient/);
    expect(d.org_doc_check).toMatch(/not that it is true/);
  });

  it('no tool description carries trial wording', () => {
    for (const [name, text] of Object.entries(describe_(host)))
      expect(text, name).not.toMatch(/\bfault|\bseed|\binject|harness|pilot|sweep|fixture/i);
  });
});
