/**
 * #571: a role with a `blueprint` and no `skills` gets its skills/skill_pool
 * from the catalog's blueprint.json when the org starts. That file lives in
 * the project's `.monomind/catalog/`, which a role may be able to write, so
 * its content is bound into the signed hash by digest (like instructions_file)
 * and start/reload use only the bytes that digest names.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOrgDefBlueprints } from '../../src/catalog/blueprints.js';
import { statePath } from '../../src/catalog/state.js';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import {
  computeOrgDefHash,
  instructionsDigests,
  OrgSignatureError,
  setOrgSignatureEnforcement,
  signOrgDef,
  verifyOrgDef,
} from '../../src/orgrt/org-signature.js';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import { writeEntry } from '../catalog/fixtures.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

beforeEach(() => {
  setOrgSignatureEnforcement(true);
  vi.stubEnv('MONOMIND_ORGRT_OPERATOR_DIR', scratch('osbp-op-'));
});
afterEach(() => {
  setOrgSignatureEnforcement(false);
  vi.unstubAllEnvs();
});

/** The pinned blueprint.json bytes of the documented example. */
const BP_JSON = '{"name":"sec","description":"Reviews code","skills":["audit"]}';
const BP_DIGEST = `sha256:${sha(BP_JSON)}`;
const ORG = {
  name: 'fx',
  goal: 'ship it',
  roles: [{ id: 'boss', type: 'boss', reports_to: null, title: 'CEO', blueprint: 'sec' }],
};
/** Documented canonical JSON (doc/commands/org.md, "The signable hash"). */
const BP_CANONICAL =
  '{"blueprints":{"sec":"sha256:bef85f02692707ae3179d10366050315d13b4ecd6383eba0a90bc1212725dc53"},' +
  '"definition":{"name":"fx","roles":[{"blueprint":"sec","id":"boss","reports_to":null,"type":"boss"}]}}';
/** Documented value for a blueprint that can't be loaded. */
const UNAVAILABLE = 'unavailable: not active for org on this machine';
const BP_HASH = '2db4cf8c4596e17c97bd20a66d30c56cdaccf6bf9fc71a4e57adbadf2d7e7508';
/** The #568 bare fixture: an org without blueprints hashes as before. */
const BARE =
  '{"name":"fx","goal":"ship it","roles":[' +
  '{"id":"boss","type":"boss","reports_to":null,"title":"CEO"},' +
  '{"reports_to":"boss","id":"dev","responsibilities":["code"],"policy":{"git":"read"}}]}';
const BARE_HASH = '2bb0a6ad90aa73e34b175333c401695c88079fb8faee131a43e27030689f247c';

/** (Re)stage blueprint `sec` with this blueprint.json, replacing any entry. */
function stage(root: string, json: string): { dir: string } {
  try {
    const state = JSON.parse(readFileSync(statePath(root), 'utf8'));
    state.entries = state.entries.filter((e: { id: string }) => e.id !== 'blueprint:sec');
    writeFileSync(statePath(root), JSON.stringify(state));
  } catch {
    /* no state yet */
  }
  return writeEntry(root, { name: 'sec', kind: 'blueprint', files: { 'blueprint.json': json } });
}

function project(): string {
  const root = scratch('osbp-root-');
  writeEntry(root, { name: 'audit' });
  writeEntry(root, { name: 'evil' });
  stage(root, BP_JSON);
  writeDef(root, ORG);
  return root;
}
function writeDef(root: string, body: unknown): void {
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(join(root, '.monomind/orgs/fx.json'), JSON.stringify(body));
}
const readDef = (root: string) =>
  JSON.parse(readFileSync(join(root, '.monomind/orgs/fx.json'), 'utf8'));

const echoQuery = ({ prompt }: any) =>
  (async function* () {
    for await (const m of prompt) {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
      yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
    }
  })();

describe('the signable hash binds blueprint content', () => {
  it('is sha256 of the documented canonical JSON (pinned)', () => {
    expect(BP_DIGEST).toBe(
      'sha256:bef85f02692707ae3179d10366050315d13b4ecd6383eba0a90bc1212725dc53',
    );
    expect(sha(BP_CANONICAL)).toBe(BP_HASH);
    const root = project();
    expect(instructionsDigests(readDef(root), root)).toEqual({ 'blueprint:sec': BP_DIGEST });
    expect(computeOrgDefHash(readDef(root), root)).toBe(BP_HASH);
    expect(signOrgDef(root, 'fx', readDef(root)).hash).toBe(BP_HASH);
  });

  it('records the documented fixed value for a blueprint that is not active', () => {
    expect(instructionsDigests(ORG, scratch('osbp-empty-'))).toEqual({ 'blueprint:sec': UNAVAILABLE });
    const root = project();
    writeDef(root, { ...ORG, roles: [{ ...ORG.roles[0], blueprint: 'nope' }] });
    expect(instructionsDigests(readDef(root), root)).toEqual({ 'blueprint:nope': UNAVAILABLE });
  });

  it('leaves orgs without blueprints unchanged, catalog or not', () => {
    const root = project();
    expect(computeOrgDefHash(JSON.parse(BARE), root)).toBe(BARE_HASH);
    expect(computeOrgDefHash(JSON.parse(BARE), scratch('osbp-empty-'))).toBe(BARE_HASH);
  });

  it('a re-staged blueprint with other skills makes the signed org verify as changed', () => {
    const root = project();
    signOrgDef(root, 'fx', readDef(root));
    expect(verifyOrgDef(root, 'fx', readDef(root))).toEqual({ ok: true });
    stage(root, '{"name":"sec","description":"Reviews code","skills":["evil"]}');
    expect(verifyOrgDef(root, 'fx', readDef(root))).toMatchObject({ ok: false, reason: 'changed' });
  });

  it('a blueprint.json edited in its package makes it verify as changed', () => {
    const root = project();
    signOrgDef(root, 'fx', readDef(root));
    const pkg = stage(root, BP_JSON); // same bytes, same digest: still signed
    expect(verifyOrgDef(root, 'fx', readDef(root))).toEqual({ ok: true });
    writeFileSync(join(pkg.dir, 'blueprint.json'), BP_JSON.replace('audit', 'evil'));
    // One fixed value, whichever check failed (a cached snapshot or a fresh one).
    expect(instructionsDigests(readDef(root), root)['blueprint:sec']).toBe(UNAVAILABLE);
    expect(verifyOrgDef(root, 'fx', readDef(root))).toMatchObject({ ok: false, reason: 'changed' });
  });
});

describe('start and reload use only the signed blueprint bytes', () => {
  it('resolution refuses a blueprint that changed after its digest was read', () => {
    const root = project();
    const raw = readDef(root);
    const digests = instructionsDigests(raw, root);
    stage(root, '{"name":"sec","description":"Reviews code","skills":["evil"]}');
    const res = resolveOrgDefBlueprints(OrgDefSchema.parse(raw), root, digests);
    expect(res.def.roles[0].skills).toBeUndefined();
    expect(res.errors.join()).toMatch(/blueprint "sec" changed since the org was signed/);
    // With the digest of what is there now, it resolves.
    const now = instructionsDigests(raw, root);
    expect(resolveOrgDefBlueprints(OrgDefSchema.parse(raw), root, now).def.roles[0].skills).toEqual([
      'evil',
    ]);
  });

  it('startOrg refuses after a blueprint change and starts with the signed skills', async () => {
    const root = project();
    signOrgDef(root, 'fx', readDef(root));
    stage(root, '{"name":"sec","description":"Reviews code","skills":["evil"]}');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    await expect(d.startOrg('fx')).rejects.toBeInstanceOf(OrgSignatureError);
    stage(root, BP_JSON);
    const running = await d.startOrg('fx');
    expect(running.def.roles[0].skills).toEqual(['audit']);

    // A mid-run change is refused on reload; the running skills stay.
    stage(root, '{"name":"sec","description":"Reviews code","skills":["evil"]}');
    expect(() => d.reloadOrgDef('fx')).toThrow(/reload refused.*changed since/);
    expect(running.def.roles[0].skills).toEqual(['audit']);
    await d.stopAll();
  });
});
