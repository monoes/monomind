// packages/@monomind/cli/__tests__/orgrt/daemon-auto-assignee.test.ts
//
// round1-issue1: `org_task`'s `assignee: "auto"` resolver (SessionOpts.pickAssignee,
// wired in daemon.ts) used to be spread onto sessionOpts only when
// decisionModelConfigured() was true. With Jev off (the default), `pickAssignee`
// was left completely `undefined`, so a caller that used `assignee: "auto"`
// anyway (e.g. from habit, docs, or a prior run with Jev configured) got a task
// created with the literal string "auto" as its assignee. dispatchReadyTasks
// (decisions.ts) only matches an assignee against a live agent or a pending
// role — "auto" is neither — so the task sat 'ready' forever, stranded, with
// only a repeating 'dispatch-assignee-unresolved' audit line to show for it.
//
// pickRoleForTask (decision/picks.ts) already falls back to deterministic
// keyword ranking over role titles/responsibilities whenever no decision
// model answers, so the fix is to stop gating the wiring itself — Jev
// on/off only changes the RESULT, never whether a resolver exists.
import { describe, expect, it, vi } from 'vitest';

// Simulates "Jev off": pickWithJev never answers, so pickRoleForTask must
// fall through to its deterministic keyword-ranking fallback.
vi.mock('../../src/decision/jev.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/decision/jev.js')>();
  return {
    ...actual,
    pickWithJev: async () => null,
  };
});

import { resolveAutoAssignee } from '../../src/orgrt/daemon.js';
import type { OrgRole } from '../../src/orgrt/types.js';

describe('resolveAutoAssignee (round1-issue1)', () => {
  const roles = [
    { id: 'boss', title: 'Boss', responsibilities: ['coordinate the team'] },
    { id: 'writer', title: 'Writer', responsibilities: ['write drafts and taglines'] },
    { id: 'reviewer', title: 'Reviewer', responsibilities: ['review drafts for accuracy'] },
  ] as unknown as OrgRole[];

  it('is wired unconditionally — never undefined — with no decision model configured', () => {
    // Before the fix this was `decisionModelConfigured() ? {pickAssignee: ...} : {}`
    // spread directly into sessionOpts, so with Jev off the field never existed at
    // all. resolveAutoAssignee replaces that gate: it must always return a resolver.
    expect(typeof resolveAutoAssignee({ roles })).toBe('function');
  });

  it('resolves assignee "auto" to a real role via keyword ranking when Jev never answers', async () => {
    const resolve = resolveAutoAssignee({ roles });
    // Reproduces the QA repro (task-1 evidence): a boss creates an org_task
    // with assignee "auto" while no decision model is configured. Before the
    // fix this task-9 exists to close, the equivalent call in daemon.ts's
    // sessionOpts was simply absent, so org_task's handler (session.ts) left
    // the literal "auto" string as the assignee instead of resolving it here.
    await expect(resolve('write a tagline')).resolves.toMatchObject({ role: 'writer', method: 'keyword' });
  });

  it('returns null (not a crash) when nothing fits, so the caller must name the assignee explicitly', async () => {
    const resolve = resolveAutoAssignee({ roles });
    await expect(resolve('zzz')).resolves.toMatchObject({ role: null, reason: 'no-match' });
  });
});
