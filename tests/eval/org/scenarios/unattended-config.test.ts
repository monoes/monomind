// Invariant (spec section 10): scheduled, unattended work must not depend on a
// human who is not there. An org that can wait on an approval nobody answers is
// flagged before it runs, and a deferred feature never starts silently.
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';

const org = (over: Record<string, unknown>) =>
  OrgDefSchema.parse({
    name: 'o',
    roles: [
      {
        id: 'boss',
        title: 'Boss',
        type: 'boss',
        responsibilities: ['Write self-contained briefs.'],
        adapter_config: { model: 'claude-opus-5' },
      },
      { id: 'w', title: 'W', reports_to: 'boss', adapter_config: { model: 'claude-sonnet-5' } },
    ],
    ...over,
  });

describe('scenario: unattended work', () => {
  it('flags a scheduled org whose approvals wait on a human', () => {
    expect(
      checklistFindings(org({ schedule: '24h' })).warnings.some((w) => w.includes('#14')),
    ).toBe(true);
  });
  it('is quiet once an autonomy decider resolves them', () => {
    expect(
      checklistFindings(org({ schedule: '24h', autonomy: { level: 'full' } })).warnings.some((w) =>
        w.includes('#14'),
      ),
    ).toBe(false);
  });
  it('refuses a deferred feature outright rather than ignoring it', () => {
    expect(checklistFindings(org({ sections: {} })).errors.join()).toMatch(/not yet supported/);
  });
});
