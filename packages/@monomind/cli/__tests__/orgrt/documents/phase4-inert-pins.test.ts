// packages/@monomind/cli/__tests__/orgrt/documents/phase4-inert-pins.test.ts
//
// Org sections P4.0 (spec 13.2.3, invariant 2), part 2 of 3. A Phase 3 sections-on org that sets none of the
// Phase 4 keys (`writes`, `budget`, `max_rework_rounds`, `loops`, `run_config.budget_usd`) must stay byte for
// byte what P3.12 pinned. This file is a SECOND, independent line of defence for it, in a file of its own so the
// P3.12 pins stay untouched:
//   1. a second copy of the sections-on constants (SECTIONS_ON_TOOLS_SHA, the four-tool and five-tool lists, the
//      four sections-on prompt SHAs), recomputed here with this file's own rendering code, plus the byte SHAs
//      of the committed P3.12 fixtures and of the e2e trail golden. Recapturing one of them to hide a failure
//      takes two edits in two files, and a reviewer sees both;
//   2. a wider net: the prompt and the tool list of EVERY role of three Phase 3 sections orgs (the P3.12 org, the
//      same with a third section, and one with `parallelism.max_parallel`), through a real OrgDaemon and a
//      scripted runner (no model), text in fixtures/phase4/inert-sections-on.json.
// A failure here means a Phase 4 piece changed bytes for an org that does not use its key: the piece is wrong,
// not this file. Only P4.11 changes role or tool text, and only for orgs that set a Phase 4 key; its new
// fingerprints live in a new file (sections-on-phase4-fingerprints.test.ts), and it re-pins nothing here.
//
// Deliberate recapture of the wider net (an intentional change to the text of an org with NO Phase 4 key, which
// no Phase 4 piece plans):
//   PHASE4_INERT_GOLDEN_UPDATE=P4.0 npx vitest run __tests__/orgrt/documents/phase4-inert-pins.test.ts
// rewrites the fixture; then re-pin FIXTURE_SHA below, and say why. The P3.12 copies in section 1 change only
// together with the originals (documents-wiring.test.ts, documents-check-wiring.test.ts,
// sections-on-fingerprints.test.ts), in the same commit.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeAgentRunner } from '../../../src/orgrt/agent-runner.js';
import type { OrgToolDef } from '../../../src/orgrt/agent-runner.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import type { DocumentToolHost } from '../../../src/orgrt/documents/runtime.js';
import { buildOrgTools } from '../../../src/orgrt/org-tools.js';
import type { SessionOpts } from '../../../src/orgrt/session-types.js';
import type { OrgDef, OrgRole } from '../../../src/orgrt/types.js';
import { findingsOrg } from '../support/doc-defs.js';
import { CaptureRunner } from '../support/doc-runner.js';
import { normalizeString } from '../support/normalize-golden.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '..', 'fixtures');
const WIDE = join(FIXTURES, 'phase4', 'inert-sections-on.json');
const UPDATE = process.env.PHASE4_INERT_GOLDEN_UPDATE === 'P4.0';
const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const fileSha = (path: string): string => sha(readFileSync(path, 'utf8'));

// ---------------------------------------------------------------------------------------------------------------
// 1. The second copy of the P3.12 pins (values as of P3.16b; originals in documents-wiring.test.ts,
//    documents-check-wiring.test.ts and sections-on-fingerprints.test.ts).
// ---------------------------------------------------------------------------------------------------------------
const SECTIONS_ON_TOOLS_SHA = 'b7fad955148d79f41c078ee4be07ee3a594a91b2ffdb8612f99fdc3098b584db';
const SECTIONS_ON_CHECK_TOOLS_SHA = 'b729606538e2deea925ccf8bab609a292be53581ef84bf4d9885bea55d6b75eb';
const PROMPT_SHAS: Record<string, string> = {
  researcher: '59e3661988c552a365109e7d57740de83644f00329ad335e23e2a3502916d69d',
  'dev-lead': '0ae92334b81786e876153f3b8039ab1c9328e1c445529f6aaf87d0e84bfaeddf',
  boss: '413bcc92ff9b931d5d2b0f87ddcdcc63a8fce9576dbaf899b737e93cd2d26601',
  observer: '05c4b06b7bc389ec68ecc5fecb1494bb5b85fbd0da8d504fba9c5f740fefe80f', // sections-as-sub-orgs re-pin: the observer is in section `watch` (was 030cd478...)
};
// Byte SHAs of the committed sections-on fixtures (sha256 of the file text).
const FIXTURE_FILE_SHAS: Record<string, string> = {
  'sections-on/prompts.json': '4103233f03be1bb04da19e2232852714f8bdf2e625b4c4061cc431fbf746afd9', // re-pin: observer prompt (was 999ce4c9...)
  'sections-on/tool-descriptions.json': '96334ac88efa033af555b21785480117a097b1e6c49bc20c7ef7d91710c54d81',
  'sections-on/e2e-sweep-trail.json': 'a0fd259995b30578dadb2459b16aade92265d2161bf7c93efef810c25e48508d',
};
// Pin of the wide net (the sha of the fixture text).
// re-pin (was ae46775e...): the observer of the three Phase 3 orgs is in section `watch`
const FIXTURE_SHA = '7b6da44974e23a77b1cc01646b42b7b88e85b0388e9505a06f5d77f872f0faab';

// The same fixture org as documents-wiring.test.ts: the session options a role is given, as a plain object.
const def = {
  name: 'acme',
  goal: 'ship the widget',
  roles: [
    { id: 'boss', title: 'Boss', type: 'coordinator', responsibilities: ['plan'] },
    { id: 'dev', title: 'Developer', type: 'specialist', reports_to: 'boss', responsibilities: ['write code', 'write tests'] },
  ],
  run_config: {},
} as unknown as OrgDef;
const four = {
  role: 'dev',
  list: () => ({ ok: true }),
  read: () => ({ ok: true }),
  publish: () => ({ ok: true }),
  decide: () => ({ ok: true }),
} as unknown as DocumentToolHost;
const five = { ...four, check: () => ({ ok: true }) } as unknown as DocumentToolHost;

const toolOpts = (documents: DocumentToolHost): SessionOpts =>
  ({
    org: 'acme',
    role: def.roles[1] as OrgRole,
    bus: {},
    policy: {},
    mailbox: {},
    cwd: '/work',
    def,
    deliver: async () => 'ok',
    askHuman: async () => 'ok',
    onComplete: () => null,
    onGate: async () => 'ok',
    recall: async () => 'ok',
    remember: async () => 'ok',
    searchKnowledge: async () => 'ok',
    createTask: () => 'ok',
    completeTask: () => 'ok',
    listTasks: () => 'ok',
    splitTask: () => 'ok',
    mergeTask: () => 'ok',
    cancelTask: () => 'ok',
    blockTask: () => 'ok',
    planGraph: () => 'ok',
    documents,
  }) as unknown as SessionOpts;

async function listedToolsSha(opts: SessionOpts): Promise<string> {
  let server: any;
  const fakeQuery = ({ options }: any) =>
    (async function* () {
      server = options.mcpServers.org;
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    })();
  for await (const _ of new ClaudeAgentRunner(fakeQuery as any).run({
    tools: buildOrgTools(opts),
    prompt: (async function* () {})(),
    systemPrompt: '',
    cwd: '/work',
  } as any)) {
    // drain
  }
  const { tools } = await server.instance.server._requestHandlers.get('tools/list')(
    { method: 'tools/list', params: {} },
    { signal: new AbortController().signal },
  );
  return sha(JSON.stringify(tools.map((t: any) => ({ name: t.name, description: t.description, schema: t.inputSchema }))));
}

describe('phase4 inert: a Phase 3 sections-on org with none of the Phase 4 keys keeps the P3.12 pins', () => {
  it('SECTIONS_ON_TOOLS_SHA, a second copy: the four-tool sections-on list', async () => {
    expect(await listedToolsSha(toolOpts(four))).toBe(SECTIONS_ON_TOOLS_SHA);
  });

  it('the five-tool sections-on list (with org_doc_check), a second copy', async () => {
    expect(await listedToolsSha(toolOpts(five))).toBe(SECTIONS_ON_CHECK_TOOLS_SHA);
  });

  it('the committed P3.12 fixtures and the e2e trail golden are byte for byte what they were', () => {
    const got = Object.fromEntries(Object.keys(FIXTURE_FILE_SHAS).map((f) => [f, fileSha(join(FIXTURES, f))]));
    expect(got).toEqual(FIXTURE_FILE_SHAS);
  });

  describe('the four sections-on prompt SHAs, a second copy (through a real daemon)', () => {
    let root: string;
    const daemons: OrgDaemon[] = [];
    const saved = { ...process.env };
    beforeEach(() => {
      process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
      process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
      root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'phase4-inert-'));
      mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    });
    afterEach(async () => {
      await Promise.all(daemons.splice(0).map((d) => d.stopAll().catch(() => {})));
      rmSync(root, { recursive: true, force: true });
      for (const k of ['MONOMIND_SPAWN_STAGGER_MS', 'MONOMIND_MIN_FREE_MEM_MB'])
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    });

    /** Start `raw` in a real daemon with a scripted runner and read what each role was started with. */
    async function capture(raw: Record<string, any>): Promise<Record<string, { prompt: string; tools: string }>> {
      writeFileSync(join(root, '.monomind/orgs', `${raw.name}.json`), JSON.stringify(raw));
      const runner = new CaptureRunner();
      const d = new OrgDaemon(root, { runner, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
      daemons.push(d);
      await d.startOrg(raw.name, undefined, { evalGate: true });
      const out: Record<string, { prompt: string; tools: string }> = {};
      for (const r of raw.roles as { id: string }[]) {
        const tools = await runner.toolsOf(d, raw.name, r.id);
        out[r.id] = {
          prompt: normalizeString(runner.systemPrompts.get(r.id) as string, { roots: [root] }),
          tools: toolsDigest(tools),
        };
      }
      await d.stopAll();
      return out;
    }

    it('researcher, dev-lead, boss and observer prompts are the P3.12 bytes', async () => {
      const got = await capture(findingsOrg());
      for (const [role, expected] of Object.entries(PROMPT_SHAS)) expect(sha(got[role].prompt), role).toBe(expected);
    });

    it('the wider net: every role of three Phase 3 sections orgs keeps its prompt and its tool list', async () => {
      const variants: Record<string, Record<string, any>> = {
        'p312-org': findingsOrg(),
        'three-sections': findingsOrg({ qa: true }),
        'max-parallel': findingsOrg(),
      };
      variants['max-parallel'].sections.development.parallelism = { max_parallel: 2 };
      const got: Record<string, unknown> = {};
      for (const [name, raw] of Object.entries(variants)) {
        got[name] = await capture(raw);
        daemons.splice(0);
      }
      const text = `${JSON.stringify(got, null, 2)}\n`;
      if (UPDATE) {
        mkdirSync(dirname(WIDE), { recursive: true });
        writeFileSync(WIDE, text);
        // eslint-disable-next-line no-console
        console.log(`FIXTURE_SHA = '${sha(text)}'`);
        return;
      }
      if (!existsSync(WIDE)) throw new Error('phase4 inert golden is missing; fixtures are committed');
      expect(got).toEqual(JSON.parse(readFileSync(WIDE, 'utf8')));
      expect(fileSha(WIDE)).toBe(FIXTURE_SHA);
    });
  });
});

/** Name, description, argument names and strictness of each tool, in order: one sha per list. */
function toolsDigest(tools: OrgToolDef[]): string {
  return sha(
    JSON.stringify(
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        args: Object.keys(t.schema),
        strict: t.strict ? (t.strict.hints ?? true) : false,
        concurrent: t.concurrent ?? false,
      })),
    ),
  );
}
