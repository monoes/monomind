// P3.15: the runtime switch end to end without a model: the variant id `v2r` (runtime-switch.mjs) prepares a trial of the REAL
// parallel-sweep-3 kit whose definition is a sections definition, and `runOrg` (run-org.ts) starts it through the eval gate on the
// runtime's own document tools with nothing attached; scripted roles then run the sweep loop on the kit's ten roles in the real
// daemon. The default (no suffix) is the harness, unchanged. No paid call: the SDK is a script.
// @ts-nocheck: plain .mjs modules and loosely typed fixtures
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DOCS,
  honestDoc,
  worker,
} from '../../../../packages/@monomind/cli/__tests__/orgrt/support/check-defs.js';
import { sectionsDefinitionFindings } from '../../../../packages/@monomind/cli/src/orgrt/documents/definition.js';
import { setOrgSignatureEnforcement } from '../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
import { handoffMetrics } from '../fixtures/parallel-sweep-3/handoff-metrics.mjs';
import { buildInputs as buildBase } from '../smoke/prepare.mjs';
import { scriptedSdk } from '../support/scripted.js';
import { preparePilotTrial } from './prepare.js';
import { pilotReport, pilotRow } from './report.js';
import { pilotOfRecord, runOrg } from './run-org.js';
import { RUNTIME_PHRASE, resolveVariant } from './runtime-switch.mjs';
import { trialView } from './runtime-view.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pilot = JSON.parse(readFileSync(join(here, 'parallel-sweep-3.pilot.json'), 'utf8'));
const BASE_PHRASE = 'handoff-relay-consistency-check';
const SCENARIO = 'parallel-sweep-3';
const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
let tmp: string;
let base: string;
beforeAll(async () => {
  process.env.MONOMIND_SPAWN_STAGGER_MS = '1';
  process.env.MONOMIND_MIN_FREE_MEM_MB = '1';
  tmp = scratch('switch-');
  base = join(tmp, 'base');
  await buildBase({ scenario: SCENARIO, base });
  setOrgSignatureEnforcement(false);
});
afterAll(() => {
  delete process.env.MONOMIND_SPAWN_STAGGER_MS;
  delete process.env.MONOMIND_MIN_FREE_MEM_MB;
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});
const record = (root: string) => JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
const orgOf = (root: string) =>
  JSON.parse(readFileSync(join(root, '.monomind/orgs', `${record(root).name}.json`), 'utf8'));

describe('resolveVariant: a declared id is the harness, the same id with "r" is the runtime, nothing else', () => {
  it('maps v2 to the harness hand-off and v2r to the runtime with both owner phrases', () => {
    expect(resolveVariant(pilot, 'v2')).toMatchObject({
      handoff: 'harness',
      variant: { id: 'v2' },
    });
    const r = resolveVariant(pilot, 'v2r');
    expect(r.handoff).toBe('runtime');
    expect(r.variant).toMatchObject({
      id: 'v2r',
      base: 'v2',
      arm: 'treatment',
      handoff: 'runtime',
      deadline_seconds: 720,
    });
    expect(r.variant.owner_decision_phrases).toEqual([BASE_PHRASE, RUNTIME_PHRASE]);
    expect(r.variant.relay).toEqual(pilot.variants[0].relay); // everything else is the base variant's
    expect(r.variant.contract_template).toEqual(pilot.variants[0].contract_template);
  });
  it('knows no other variant: unknown ids, a suffix on an unknown base, a base without the relay', () => {
    expect(resolveVariant(pilot, undefined)).toBeUndefined();
    expect(resolveVariant(pilot, 'v9')).toBeUndefined();
    expect(resolveVariant(pilot, 'v9r')).toBeUndefined();
    expect(resolveVariant(pilot, 'r')).toBeUndefined();
    const sweep2 = JSON.parse(readFileSync(join(here, 'parallel-sweep-2.pilot.json'), 'utf8'));
    for (const v of sweep2.variants ?? []) {
      expect(resolveVariant(sweep2, v.id)?.handoff).toBe('harness'); // declared ids unchanged
      expect(resolveVariant(sweep2, `${v.id}r`)).toBeUndefined(); // no relay in the base: not switchable
    }
  });
  it('the committed manifest declares no id ending in r, so the default cannot be reinterpreted', () => {
    expect(pilot.variants.map((v) => v.id).filter((id) => id.endsWith('r'))).toEqual([]);
  });
});

describe('prepare: default off, switch on', () => {
  it('a plain treatment trial and a v2 trial are exactly the harness trials of before (no sections, the placeholder provider)', async () => {
    for (const variant of [undefined, 'v2']) {
      const root = await preparePilotTrial({
        scenario: SCENARIO,
        base,
        arm: 'treatment',
        n: variant ? 3 : 4,
        ...(variant ? { variant } : {}),
      });
      const def = orgOf(root);
      expect(def.sections).toBeUndefined();
      expect(def.documents).toBeUndefined();
      expect(def.run_config.experimental).toBeUndefined();
      expect(def.roles.find((r) => r.id === 'worker-1').tool_providers[0].name).toBe('pilot');
      expect(record(root).pilot.handoff).toBeUndefined();
      expect(pilotOfRecord(record(root)).handoff).toBeUndefined();
      expect(record(root).task).toContain('pilot__doc_');
    }
  });

  it("v2r: a sections definition the runtime accepts, the store hidden from every role, the text in the runtime tools' names, no fault plan", async () => {
    const root = await preparePilotTrial({
      scenario: SCENARIO,
      base,
      arm: 'treatment',
      n: 1,
      variant: 'v2r',
    });
    const t = record(root);
    const def = orgOf(root);
    expect(t.name).toBe('smoke-parallel-sweep-3-phase2-p1t-v2r');
    expect(t.pilot).toMatchObject({
      arm: 'treatment',
      handoff: 'runtime',
      variant: { id: 'v2r', base: 'v2', handoff: 'runtime', ownerApproved: true },
    });
    expect(t.pilot.faults).toBeUndefined(); // the runtime has no injector
    expect(t.pilot.relay).toBeUndefined(); // the runtime relays on its own
    expect(pilotOfRecord(t)).toMatchObject({ handoff: 'runtime' });
    // the definition
    expect(def.requires).toEqual({ sections: 1 });
    expect(def.run_config).toMatchObject({
      experimental: 'eval',
      completion: { mode: 'boss', protocol: 'sections-v1' },
      workspace: join(root, 'workspace'),
    });
    expect(Object.keys(def.documents)).toEqual(pilot.contracts.map((c) => c.id));
    expect(Object.keys(def.sections)).toEqual([
      'sweep-a',
      'sweep-b',
      'sweep-c',
      'sweep-d',
      'synthesis',
    ]);
    expect(def.documents['module-sheets-w1'].deliverable_files).toHaveLength(4);
    const parsed = OrgDefSchema.parse(def);
    expect(sectionsDefinitionFindings(parsed).errors).toEqual([]);
    expect(checklistFindings(parsed).errors).toEqual([]);
    for (const r of def.roles) expect(r.tool_providers).toBeUndefined();
    // the run's store directory is denied to every role, as pilot-state/ was for the harness store
    const docs = join(root, '.monomind/orgs', t.name, 'docs');
    for (const r of def.roles) {
      expect(r.policy.sandbox.denyRead).toContain(docs);
      expect(r.policy.sandbox.denyWrite).toContain(docs);
    }
    // the text says org_doc_*, not pilot__doc_*
    expect(t.task).toContain('org_doc_publish');
    expect(JSON.stringify(def)).not.toMatch(/pilot__|pilot-relay/);
  }, 60000);

  it('refuses the switch for an arm the variant is not, and for ids that are neither declared nor switchable', async () => {
    await expect(
      preparePilotTrial({ scenario: SCENARIO, base, arm: 'baseline', n: 1, variant: 'v2r' }),
    ).rejects.toThrow(/treatment arm only/);
    await expect(
      preparePilotTrial({ scenario: SCENARIO, base, arm: 'treatment', n: 1, variant: 'v9r' }),
    ).rejects.toThrow(/does not list the variant "v9r"/);
  });
});

describe('run-all.sh and the stage gate take the switch from the same commands as the pilot', () => {
  const runAll = join(here, 'run-all.sh');
  const gate = join(here, 'stage-gate.mjs');
  it('run-all.sh parses and splits PILOT_ONLY with the variant in the sixth field', () => {
    expect(spawnSync('bash', ['-n', runAll]).status).toBe(0);
    const out = execFileSync('bash', [
      '-c',
      'IFS=":" read -r sc arm n redo profile variant <<< "parallel-sweep-3:treatment:1:0::v2r"; echo "$sc|$arm|$n|$redo|$profile|$variant"',
    ])
      .toString()
      .trim();
    expect(out).toBe('parallel-sweep-3|treatment|1|0||v2r');
  });
  it('the gate refuses v2r without the owner decision naming both phrases, and allows it with both', () => {
    const run = (decision?: string) =>
      spawnSync('node', [gate, SCENARIO, base, 'treatment', '1', 'v2r'], {
        encoding: 'utf8',
        env: { ...process.env, PILOT_OWNER_DECISION: decision ?? '' },
      });
    const none = run();
    expect(none.status).toBe(1);
    expect(none.stdout).toContain(
      `needs PILOT_OWNER_DECISION naming "${BASE_PHRASE}" and "${RUNTIME_PHRASE}"`,
    );
    expect(run(BASE_PHRASE).status).toBe(1); // the harness variant's phrase alone is not the runtime switch's
    expect(run(RUNTIME_PHRASE).status).toBe(1);
    const ok = run(`the owner, ${BASE_PHRASE} and ${RUNTIME_PHRASE}`);
    expect(ok.status).toBe(0);
    expect(ok.stdout).toMatch(/variant v2r stage 1/);
    expect(
      spawnSync('node', [gate, SCENARIO, base, 'treatment', '1', 'v2'], {
        encoding: 'utf8',
        env: { ...process.env, PILOT_OWNER_DECISION: BASE_PHRASE },
      }).status,
    ).toBe(0); // the harness variant as before
  });
  it('run-all.sh with PILOT_ONLY=...::v2r and no owner decision stops at the gate, before anything is prepared or run', () => {
    mkdirSync(join(base, 'inputs', SCENARIO), { recursive: true });
    const r = spawnSync('bash', [runAll, base, '/nonexistent/cli.js'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PILOT_ONLY: `${SCENARIO}:treatment:1:0::v2r`,
        PILOT_OWNER_DECISION: '',
      },
    });
    expect(r.status).toBe(6);
    expect(readFileSync(join(base, 'pilot-run-all.log'), 'utf8')).toMatch(
      new RegExp(
        `GATE refused: ${SCENARIO} treatment 1 \\{v2r\\}: variant v2r needs PILOT_OWNER_DECISION naming`,
      ),
    );
  });
});

describe("runOrg on the runtime switch: the kit's ten roles in the real daemon, scripted", () => {
  it('starts through the eval gate with the runtime tools, runs the sweep loop with a scripted fault, and the trial reads as a runtime trial', async () => {
    const root = await preparePilotTrial({
      scenario: SCENARIO,
      base,
      arm: 'treatment',
      n: 2,
      variant: 'v2r',
    });
    const t = record(root);
    const def = orgOf(root);
    const ws = def.run_config.workspace;
    const sheetFiles = (doc: string, body = honestDoc(doc)) => {
      for (const s of body.sheets) {
        mkdirSync(join(ws, 'out', s.module), { recursive: true });
        writeFileSync(
          join(ws, 'out', s.module, 'answers.json'),
          JSON.stringify({
            module: s.module,
            answers: s.answers.map(({ q, value, files }) => ({ q, value, files })),
          }),
        );
      }
    };
    const wrong = (doc: string) => {
      const b = honestDoc(doc);
      b.sheets[2].answers[4].value += 7; // the value no longer follows from its evidence
      return b;
    };
    const accepted = new Set<string>();
    const workers = DOCS.map(worker);
    const sdk = scriptedSdk((role, turn, message) => {
      const subject = /subject: (.*)/.exec(message)?.[1] ?? '';
      if (role === 'lead')
        return turn === 0
          ? {
              tools: workers.map((w) => ({
                name: 'org_send',
                args: { to: w, subject: 'work', message: 'produce your sheets' },
              })),
            }
          : /synthesis done/.test(message)
            ? { tools: [{ name: 'org_complete', args: { outcome: 'achieved', summary: 'done' } }] }
            : {};
      if (role.startsWith('worker-')) {
        const doc = `module-sheets-w${role.at(-1)}`;
        if (subject === 'work') {
          const body = role === 'worker-1' ? wrong(doc) : honestDoc(doc);
          sheetFiles(doc, body);
          return { tools: [{ name: 'org_doc_publish', args: { type: doc, body } }] };
        }
        const m = /^document rejected: (\S+) v(\d+)$/.exec(subject);
        if (m) {
          sheetFiles(doc);
          return {
            tools: [
              {
                name: 'org_doc_publish',
                args: { type: doc, body: honestDoc(doc), supersedes: `${m[1]}@v${m[2]}` },
              },
            ],
          };
        }
        return {};
      }
      if (role === 'synthesiser') {
        const tools: { name: string; args: Record<string, unknown> }[] = [];
        for (const m of message.matchAll(/document ready: (\S+) v(\d+)/g)) {
          const [, id, v] = m;
          const bad = id === 'module-sheets-w1-1' && v === '1';
          // org_doc_decide needs every part read (P3.16b); a sheet is four parts, and a part past the last is refused harmlessly
          tools.push({ name: 'org_doc_read', args: { id, version: Number(v) } });
          for (let part = 2; part <= 6; part++)
            tools.push({ name: 'org_doc_read', args: { id, version: Number(v), part } });
          tools.push({ name: 'org_doc_check', args: { id, version: Number(v) } });
          tools.push({
            name: 'org_doc_decide',
            args: {
              id,
              version: Number(v),
              decision: bad ? 'reject' : 'accept',
              ...(bad ? { reason: 'm3 q05: value_matches_chain' } : {}),
            },
          });
          if (!bad) accepted.add(id);
        }
        if (accepted.size === 8) {
          mkdirSync(join(ws, 'out'), { recursive: true });
          writeFileSync(join(ws, 'out', 'synthesis.json'), '{}');
          tools.push({
            name: 'org_send',
            args: { to: 'lead', subject: 'synthesis done', message: 'synthesis done' },
          });
          accepted.add('sent');
        }
        return { tools };
      }
      return {};
    });
    // the run command's own path: the trial record decides what is attached (nothing), the eval gate is passed for a sections definition
    await runOrg({
      root,
      name: t.name,
      task: t.task,
      pilot: pilotOfRecord(t),
      queryFn: sdk.queryFn,
      pollMs: 50,
    });
    const results = (name: string) => sdk.toolResults.filter((r) => r.name === name);
    expect(results('org_doc_publish').map((r) => r.json.ok)).toEqual(
      expect.arrayContaining([true]),
    );
    expect(results('org_doc_publish').filter((r) => r.json.ok)).toHaveLength(9); // eight documents and worker-1's republish
    expect(results('org_doc_decide').filter((r) => r.json.ok)).toHaveLength(9);
    expect(
      results('org_doc_check').filter((r) => r.json.ok && r.json.flagged_count > 0),
    ).toHaveLength(1); // the scripted fault was flagged
    expect(sdk.turns.get('lead')).toBeGreaterThanOrEqual(2);
    expect(
      Object.keys(sdk.options.get('worker-1')[0].mcpServers.org.instance._registeredTools),
    ).toEqual(
      expect.arrayContaining(['org_doc_publish', 'org_doc_read', 'org_doc_list', 'org_doc_decide']),
    );
    // what the trial left, read as a runtime trial
    const view = trialView(root);
    expect(view.source).toBe('runtime');
    expect(view.events.filter((e) => e.kind === 'publish' && e.ok)).toHaveLength(9);
    expect(
      Object.fromEntries(
        Object.entries(view.state.versions).map(([d, vs]) => [d, vs.at(-1).status]),
      ),
    ).toEqual(Object.fromEntries(DOCS.map((d) => [d, 'accepted'])));
    writeFileSync(join(root, 'result.json'), '{"seconds":1}');
    const row = pilotRow(root);
    expect(row).toMatchObject({
      arm: 'treatment',
      n: 2,
      variant: 'v2r',
      handoffLayer: 'runtime',
      handoff: { publish: { ok: 9, refused: 0 }, decide: { ok: 9, refused: 0 }, relays: 2 },
    });
    expect(row.handoff.check.ok).toBe(9);
    expect(row.handoffByRole.synthesiser.decide.ok).toBe(9);
    const m = handoffMetrics({
      root,
      truth: {
        modules: Object.fromEntries(
          DOCS.flatMap((d) =>
            honestDoc(d).sheets.map((s) => [
              s.module,
              Object.fromEntries(s.answers.map((a) => [a.q, { value: a.value, files: a.files }])),
            ]),
          ),
        ),
      },
    });
    expect(m).toMatchObject({
      present: true,
      handoff_layer: 'runtime',
      injected: null,
      caught: null,
      republish_cycles: 1,
      final_accepted_docs: 8,
      final_accepted_correct: 8,
      rejects_of_natural_errors: 1,
    });
    expect(m.docs_decided.synthesiser).toHaveLength(8);
    const rep = pilotReport([row]);
    expect(rep.scenarios[0].pairs[0].treatmentV2r.name).toBe(t.name);
    expect(rep.scenarios[0].pairs[0].reasons.join(' ')).toMatch(/a variant trial only \(v2r\)/);
  }, 120000);
});
