// parallel-sweep-3 variant v2 through the REAL org daemon, scripted (no model, no spend): the producer relay really
// reaches the producing role's mailbox and the lead's through the daemon's deliver, a cross-section send by a role is
// still refused on that same path, and the store reads the files at the workspace the trial record names (the one the
// roles write to). The roles are idle stand-ins; the test drives the store as the roles' tools would.
// @ts-nocheck: plain .mjs modules
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorityMaskAvailability } from '../../../../../../packages/@monomind/cli/src/orgrt/authority-mask.js';
import { OrgDaemon } from '../../../../../../packages/@monomind/cli/src/orgrt/daemon.js';
import { setOrgSignatureEnforcement } from '../../../../../../packages/@monomind/cli/src/orgrt/org-signature-enforcement.js';
import { startOrgServer } from '../../../../../../packages/@monomind/cli/src/orgrt/server.js';
import { attachPilot } from '../../../pilot/harness.js';
import { preparePilotTrial } from '../../../pilot/prepare.js';
import { pilotOfRecord, withoutNativeChildren } from '../../../pilot/run-org.js';
import { scriptedSdk, waitUntil } from '../../../support/scripted.js';
import { buildInputs as buildBase } from '../../prepare.mjs';
import { id } from './kit.mjs';

const scratch = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
let tmp: string;
let base: string;
beforeAll(async () => {
  tmp = scratch('sweep3-dry2-');
  base = join(tmp, 'base');
  await buildBase({ scenario: id, base });
  setOrgSignatureEnforcement(false);
});
afterAll(() => {
  spawnSync('chmod', ['-R', 'u+w', tmp]);
  rmSync(tmp, { recursive: true, force: true });
});

describe('v2 through the real daemon, scripted', () => {
  // the kit's roles run in the no-node bubblewrap layer (mode required), which a host without bubblewrap refuses
  it.skipIf(!authorityMaskAvailability().available)(
    'a rejection lands in the producer mailbox and the lead copy, the workspace is the one the roles write, and a role-to-role cross-section send is still refused',
    async () => {
      const root = await preparePilotTrial({
        scenario: id,
        base,
        arm: 'treatment',
        n: 9,
        variant: 'v2',
      });
      const t = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      const def = JSON.parse(readFileSync(join(root, '.monomind/orgs', `${t.name}.json`), 'utf8'));
      expect(def.run_config.workspace).toBe(t.pilot.workspace);
      const truth = JSON.parse(readFileSync(join(base, 'inputs', id, 'truth.json'), 'utf8'));
      const sheet = (m: string) => ({
        module: m,
        answers: Object.entries(truth.modules[m]).map(([q, x]: [string, any]) => ({
          q,
          value: x.value,
          files: x.files,
        })),
      });
      for (let i = 1; i <= 4; i++) {
        mkdirSync(join(t.pilot.workspace, 'out', `m${i}`), { recursive: true });
        writeFileSync(
          join(t.pilot.workspace, 'out', `m${i}`, 'answers.json'),
          JSON.stringify(sheet(`m${i}`)),
        );
      }
      const content = {
        worker: 'worker-1',
        sheets: [1, 2, 3, 4].map((i) => {
          const s = sheet(`m${i}`);
          return {
            ...s,
            answers: s.answers.map((a) => ({
              ...a,
              evidence: a.files.map((file: string, k: number) => ({
                file,
                in: k,
                out: k ? 5 : a.value,
              })),
            })),
          };
        }),
      };

      // the trial the run command attaches (run-org.ts main block) carries the relay and the workspace of the record
      const pilot = pilotOfRecord(t);
      expect(pilot).toMatchObject({ relay: { copy_to: ['lead'] }, workspace: t.pilot.workspace });
      expect(pilotOfRecord({ pilot: { arm: 'baseline' } })).toBeUndefined();
      expect(
        (
          await pilotOfRecord(
            JSON.parse(
              readFileSync(
                join(
                  await preparePilotTrial({ scenario: id, base, arm: 'treatment', n: 8 }),
                  'trial.json',
                ),
                'utf8',
              ),
            ),
          )
        )?.relay,
      ).toBeUndefined();
      const sdk = scriptedSdk(() => ({}));
      const daemon = new OrgDaemon(root, {
        crossProcess: true,
        queryFn: withoutNativeChildren(sdk.queryFn),
      });
      const store = attachPilot(daemon, pilot, t.pilot.runId);
      const srv = await startOrgServer(daemon, 0);
      daemon.setInboxUrl(`http://127.0.0.1:${srv.port}`, srv.operatorCredential);
      try {
        await daemon.startOrg(t.name, t.task, {
          resume: false,
          autoApprove: ['Bash', 'org_complete'],
        });
        expect(store.publish('worker-1', 'module-sheets-w1', content)).toMatchObject({
          ok: true,
          version: 1,
        });
        expect(
          store.decide(
            'synthesiser',
            'module-sheets-w1',
            1,
            'reject',
            'm2 q04 value does not match the code',
          ),
        ).toMatchObject({ ok: true, status: 'rejected' });
        const got = (role: string) =>
          (sdk.messages.get(role) ?? []).filter((m) => m.includes('module-sheets-w1'));
        expect(
          await waitUntil(
            () =>
              got('worker-1').length >= 1 &&
              got('lead').length >= 1 &&
              got('synthesiser').length >= 1,
            8000,
          ),
        ).toBe(true);
        expect(got('worker-1')).toHaveLength(1);
        expect(got('worker-1')[0]).toMatch(
          /rejected version 1 of document "module-sheets-w1".*m2 q04 value does not match the code.*1 of 4 used, 3 left/,
        );
        expect(got('lead')[0]).toMatch(/worker-1 was notified directly/);
        // the synthesiser's one message is the publish notice (declared change consumer-publish-notice): no reason, no fault
        expect(got('synthesiser')).toHaveLength(1);
        expect(got('synthesiser')[0]).toMatch(
          /worker-1 published version 1 of document "module-sheets-w1"/,
        );
        expect(got('synthesiser')[0]).not.toMatch(/rejected|m2 q04/);
        expect(got('lead')).toHaveLength(1);
        expect(await daemon.deliver(t.name, 'worker-1', 'synthesiser', 's', 'hello')).toMatch(
          /^Refused: worker-1 \(section sweep-a\) cannot message synthesiser/,
        );
        expect(store.events().filter((e) => e.kind === 'relay' && !e.ok)).toEqual([]);
        expect(store.events().filter((e) => e.kind === 'send-refused')).toHaveLength(1);
      } finally {
        await daemon.stopAll();
        srv.close();
      }
    },
    60000,
  );
});
