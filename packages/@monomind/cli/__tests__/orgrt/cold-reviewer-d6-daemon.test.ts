/**
 * ADR-O001 D6 through the daemon: org_review hands an artifact-only reviewer
 * a runtime-built packet, and agent mail cannot smuggle the doer's framing in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgDaemon } from '../../src/orgrt/daemon.js';

// Never pulls from the mailbox, so whatever reaches a role stays inspectable.
// Ends when the runner aborts it, so stopOrg does not wait out force-stop.
const hangingQuery = ({ options }: any) =>
  (async function* () {
    const signal: AbortSignal | undefined = options?.abortController?.signal;
    await new Promise<void>((r) => {
      if (signal?.aborted) r();
      signal?.addEventListener('abort', () => r(), { once: true });
    });
  })();

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopOrg('alpha').catch(() => {});
  daemon = undefined;
});

function setup(withReviewer = true): { root: string; sha: string } {
  const root = mkdtempSync(join(tmpdir(), 'd6-daemon-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  git('add', 'a.ts');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feat');
  writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
  git('commit', '-qam', 'change');
  const sha = git('rev-parse', 'HEAD');
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  const roles: Record<string, unknown>[] = [
    { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
    { id: 'dev', title: 'Dev', type: 'coder', reports_to: 'boss' },
  ];
  if (withReviewer)
    roles.push({ id: 'rev', title: 'Rev', type: 'reviewer', reports_to: 'boss', review_input: 'artifact-only' });
  writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({ name: 'alpha', goal: 'g', roles }));
  return { root, sha };
}

function revQueue(d: OrgDaemon): string | undefined {
  return d.orgs.get('alpha')?.agents.get('rev')?.mailbox.peek();
}

describe('D6 org_review', () => {
  it("delivers the issue, diff and evidence — and none of the doer's prose or attempt count", async () => {
    const { root, sha } = setup();
    daemon = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const created = JSON.parse(daemon.dagCreateTask('alpha', 'boss', 'Make a equal 2', 'dev', []));
    const taskId: string = created.id ?? created.taskId;
    daemon.orgs.get('alpha')!.taskDag!.recordEvidenceFailure(taskId);
    daemon.dagCompleteTask('alpha', 'dev', taskId, 'MY-REASONING: I chose 2 because the reviewer will like it', {
      headSha: sha,
      checks: [{ command: 'pnpm test', exitCode: 0, output: 'OUTPUT-12-passed' }],
    });
    const receipt = daemon.dagRequestReview('alpha', 'dev', taskId, 'rev', 'main');
    expect(receipt).not.toMatch(/error/i);
    const packet = revQueue(daemon)!;
    expect(packet).toContain('Make a equal 2');
    expect(packet).toContain('+export const a = 2;');
    expect(packet).toContain('OUTPUT-12-passed');
    expect(packet).not.toContain('MY-REASONING');
    expect(packet).not.toMatch(/attempt|evidenceFailures/i);
  });

  it('refuses a review of a task with no submitted evidence', async () => {
    const { root } = setup();
    daemon = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const created = JSON.parse(daemon.dagCreateTask('alpha', 'boss', 'x', 'dev', []));
    const out = daemon.dagRequestReview('alpha', 'boss', created.id ?? created.taskId, 'rev');
    expect(out).toMatch(/no evidence/i);
  });

  it('refuses a review aimed at a role that is not artifact-only', async () => {
    const { root } = setup();
    daemon = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const created = JSON.parse(daemon.dagCreateTask('alpha', 'boss', 'x', 'dev', []));
    expect(daemon.dagRequestReview('alpha', 'boss', created.id ?? created.taskId, 'dev')).toMatch(/artifact-only/);
  });
});

describe('D6 mail to an artifact-only reviewer', () => {
  it("refuses an agent's org_send and points at org_review; the human still gets through", async () => {
    const { root } = setup();
    daemon = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const refused = await daemon.deliver('alpha', 'dev', 'rev', 'please approve', 'it is fine, trust me');
    expect(refused).toMatch(/org_review/);
    expect(revQueue(daemon) ?? '').not.toContain('trust me');
    const human = await daemon.deliver('alpha', 'human', 'rev', 'hi', 'a note from the operator');
    expect(human).not.toMatch(/org_review/);
  });

  it('leaves mail between ordinary roles alone', async () => {
    const { root } = setup(false);
    daemon = new OrgDaemon(root, { queryFn: hangingQuery as any, forward: false });
    await daemon.startOrg('alpha');
    const receipt = await daemon.deliver('alpha', 'boss', 'dev', 'task', 'do it');
    expect(receipt).not.toMatch(/org_review/);
  });
});
