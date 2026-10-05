// packages/@monomind/cli/__tests__/orgrt/documents/writer-boundary.test.ts
// P4.4: the reduced probe at role start (writer-boundary.ts). A read-only role whose sandbox boundary fell back to
// protecting only the workspace's existing children is held, with an audit event and a clear message, and its
// access is never widened. The restrictions are the real builder's (with the stub hold stubbed to say a stub is
// missing, which is what makes it expand); one case runs the produced deny list under the real bubblewrap and is
// skipped where bubblewrap cannot run, as sandbox-deny-write.test.ts does.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../../../../../tests/setup/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { effectiveRole } from '../../../src/orgrt/effective-role-policy.js';
import { resolveRoleGitEnforcement } from '../../../src/orgrt/role-sandbox.js';
import { OrgDefSchema, type OrgDef, type OrgRole } from '../../../src/orgrt/types.js';
import { assertWriterBoundary } from '../../../src/orgrt/writer-boundary.js';
import { sectionsRaw } from '../support/sections-defs.js';

type Raw = Record<string, any>;
const tmp = (p: string) => realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), p)));
const NO_FILE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'];
const def = (patch: (raw: Raw) => void = () => {}): OrgDef => OrgDefSchema.parse(sectionsRaw(patch));
const oneWriter = (raw: Raw) => {
  raw.sections.research.writes = ['src/**'];
  raw.roles.find((r: Raw) => r.id === 'research-lead').policy = { denyTools: [...NO_FILE_TOOLS, 'Bash'] };
};
const roleOf = (d: OrgDef, id: string): OrgRole => d.roles.find((r) => r.id === id) as OrgRole;

function project() {
  const root = tmp('wb-');
  spawnSync('git', ['init', '-q', root]);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'README.md'), 'x');
  return root;
}

/** The held-start check for one role, with what the real sandbox layer produced for it. */
function start(d: OrgDef, id: string, root: string, missingStubs: string[], claudeRuntime = true) {
  const bus = new OrgBus('o', 'r', tmp('wb-bus-'));
  const events: any[] = [];
  bus.subscribe((e) => events.push(e));
  const role = effectiveRole(d, roleOf(d, id), { orgRoot: root, workdir: root });
  const { claudeRestrictions } = resolveRoleGitEnforcement({
    org: 'o',
    role,
    cwd: root,
    orgRoot: root,
    orgDir: join(root, '.monomind', 'orgs', 'o'),
    bus,
    claudeRuntime,
    availability: { available: true },
    holdStubs: () => missingStubs,
  });
  const run = () =>
    assertWriterBoundary({ def: d, role, cwd: root, orgRoot: root, bus, restrictions: claudeRestrictions, claudeRuntime });
  return { run, events, restrictions: claudeRestrictions };
}

describe('writer boundary at role start (P4.4)', () => {
  const d = def(oneWriter);

  it('qualifies a read-only role whose workspace is one plain deny (every stub held)', () => {
    const root = project();
    const { run, events } = start(d, 'coder', root, []);
    expect(run).not.toThrow();
    expect(events.filter((e) => e.reason === 'writer-boundary-unqualified')).toEqual([]);
  });

  it('holds a read-only role whose deny was expanded into the children, with an audit event and a clear message', () => {
    const root = project();
    const { run, events, restrictions } = start(d, 'coder', root, [join(root, '.mcp.json')]);
    // the real builder really did fall back: children are denied, the workspace itself is not
    const deny = (restrictions?.sandbox as any).filesystem.denyWrite as string[];
    expect(deny).not.toContain(root);
    expect(deny.some((p) => p.startsWith(`${root}/`))).toBe(true);
    let err: any;
    try {
      run();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.fatal).toBe(true);
    expect(err.message).toMatch(/^roles\.coder: the read-only boundary for .* is not qualified \(the deny was expanded into the children of /);
    expect(err.message).toContain("the role's start is held rather than widened");
    const audit = events.filter((e) => e.reason === 'writer-boundary-unqualified');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ type: 'audit', from: 'coder', msg: err.message });
  });

  it('never widens: nothing but the hold changes, and a writer in the same state is not held', () => {
    const root = project();
    const writer = start(d, 'researcher', root, [join(root, '.mcp.json')]);
    expect(writer.run).not.toThrow();
  });

  it('is a no-op without an overlay (sections off, or no writes), for a non-Claude runner, and for no sandbox object', () => {
    const root = project();
    const none = def();
    expect(start(none, 'coder', root, [join(root, '.mcp.json')]).run).not.toThrow();
    expect(start(d, 'coder', root, [join(root, '.mcp.json')], false).run).not.toThrow();
  });

  it('holds a Claude role that got no sandbox at all (the overlay asks for one)', () => {
    const root = project();
    const bus = new OrgBus('o', 'r', tmp('wb-bus-'));
    const role = effectiveRole(d, roleOf(d, 'coder'), { orgRoot: root, workdir: root });
    expect(() =>
      assertWriterBoundary({ def: d, role, cwd: root, orgRoot: root, bus, restrictions: { }, claudeRuntime: true }),
    ).toThrow(/no deny-write covers the workspace/);
  });
});

const bwrapWorks =
  process.platform === 'linux' &&
  spawnSync('bwrap', ['--dev-bind', '/', '/', 'true'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!bwrapWorks)('the deny list the overlay produces, under the real bubblewrap', () => {
  const d = def(oneWriter);
  /** Run `script` with the sandbox's deny-write entries bound read-only over the host, as the SDK does. */
  const inSandbox = (deny: string[], script: string) =>
    spawnSync('bwrap', ['--dev-bind', '/', '/', ...deny.flatMap((p) => ['--ro-bind', p, p]), 'sh', '-c', script], {
      encoding: 'utf8',
    });

  it('a non-writer\'s shell redirect, touch and rm in the workspace fail; the same commands succeed without the deny', () => {
    const root = project();
    const { restrictions } = start(d, 'coder', root, []);
    const deny = (restrictions?.sandbox as any).filesystem.denyWrite as string[];
    const blocked = inSandbox(deny, `echo hi > ${root}/src/new.txt; touch ${root}/fresh; rm -f ${root}/README.md`);
    expect(existsSync(join(root, 'src', 'new.txt'))).toBe(false);
    expect(existsSync(join(root, 'fresh'))).toBe(false);
    expect(existsSync(join(root, 'README.md'))).toBe(true);
    expect(blocked.stderr).toMatch(/Read-only file system/);
    // control: with no deny list the same script writes
    inSandbox([], `echo hi > ${root}/src/new.txt; touch ${root}/fresh; rm -f ${root}/README.md`);
    expect(readFileSync(join(root, 'src', 'new.txt'), 'utf8')).toBe('hi\n');
    rmSync(root, { recursive: true, force: true });
  });
});
