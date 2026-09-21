// packages/@monomind/cli/__tests__/orgrt/gates-in-memory.test.ts
/**
 * A running org's decision gates are authoritative in memory. gates.json sits
 * in a directory the org's roles can write, so a role that rewrote it — or
 * swapped the directory holding it — must not be able to approve its own gate.
 */
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

const quiet = ({ prompt }: any) =>
  (async function* () {
    for await (const _m of prompt) {
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

const daemons: OrgDaemon[] = [];
afterEach(async () => {
  for (const d of daemons.splice(0)) await d.stopAll().catch(() => {});
});

async function running() {
  const root = mkdtempSync(join(tmpdir(), 'gates-mem-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/acme.json'),
    JSON.stringify({ name: 'acme', goal: 'g', roles: [{ id: 'boss', type: 'boss', reports_to: null }] }),
  );
  const daemon = new OrgDaemon(root, { queryFn: quiet as any, forward: false });
  daemons.push(daemon);
  await daemon.startOrg('acme');
  const file = join(root, '.monomind/orgs/acme/gates.json');
  const forge = () =>
    writeFileSync(
      file,
      JSON.stringify({ gates: daemon.listGates('acme').map((g) => ({ ...g, status: 'approved' })) }),
    );
  return { root, daemon, file, forge };
}

describe('decision gates of a running org', () => {
  it('ignore a role rewriting gates.json: the gate stays pending', async () => {
    const { daemon, forge } = await running();
    await daemon.createGate('acme', 'boss', 'ship', 'go?');
    forge();
    expect(daemon.listGates('acme', 'pending')).toHaveLength(1);
  });

  it('ignore a swapped org directory holding a forged gates.json', async () => {
    const { root, daemon, forge } = await running();
    await daemon.createGate('acme', 'boss', 'ship', 'go?');
    const dir = join(root, '.monomind/orgs/acme');
    renameSync(dir, `${dir}-moved`);
    mkdirSync(dir);
    forge();
    expect(daemon.listGates('acme', 'pending')).toHaveLength(1);
  });

  it('still resolve through the daemon, write the file through, and restore it on stop', async () => {
    const { daemon, file, forge } = await running();
    await daemon.createGate('acme', 'boss', 'ship', 'go?');
    const [gate] = daemon.listGates('acme', 'pending');
    await daemon.resolveGate('acme', gate.id, false, 'not yet', 'human');
    expect(JSON.parse(readFileSync(file, 'utf8')).gates[0]).toMatchObject({ status: 'rejected' });
    await daemon.createGate('acme', 'boss', 'again', 'go?');
    forge();
    await daemon.stopOrg('acme');
    const onDisk = JSON.parse(readFileSync(file, 'utf8')).gates;
    expect(onDisk.map((g: any) => g.status)).toEqual(['rejected', 'pending']);
  });

  it('read a stopped org from the file, so an offline resolution reaches the next run', async () => {
    const { daemon, file } = await running();
    await daemon.createGate('acme', 'boss', 'ship', 'go?');
    await daemon.stopOrg('acme');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.gates[0].status = 'approved';
    writeFileSync(file, JSON.stringify(data));
    expect(daemon.listGates('acme', 'pending')).toHaveLength(0);
    await daemon.startOrg('acme');
    expect(daemon.listGates('acme', 'approved')).toHaveLength(1);
  });
});
