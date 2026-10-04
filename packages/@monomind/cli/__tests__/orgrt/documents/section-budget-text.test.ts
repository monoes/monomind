// P4.6: the exact words of the section budget notices, the assignment refusal and the closure detail (pure
// functions, no daemon). The sentences are pinned whole, so a wording change is a deliberate edit of this file.
import { describe, expect, it } from 'vitest';
import {
  assignmentRefusal,
  closureDetail,
  closureNotice,
  closureRemedy,
  roleWarningCopy,
  scopeLabel,
  warningNotice,
} from '../../../src/orgrt/documents/section-budget-text.js';

const section = { kind: 'section' as const, name: 'research', spentUsd: 24, allocationUsd: 30 };
const reserve = { kind: 'reserve' as const, spentUsd: 34, allocationUsd: 40 };
const org = { kind: 'org' as const, spentUsd: 80, allocationUsd: 100 };

describe('the 80 percent warning', () => {
  it('names the section, spend, allocation, fraction, the effect and the options', () => {
    expect(warningNotice(section)).toEqual({
      subject: 'budget: section "research" at 80 percent of its USD allocation',
      body:
        'Section "research" has spent $24.00 of its USD allocation (sections.research.budget.usd), $30.00 (80 percent). ' +
        'At 100 percent it is soft-closed: its roles take no new work, no new task can be assigned into it, and its open tasks are held; sessions already running finish their turn. ' +
        'Options: raise sections.research.budget.usd and hot-reload it (monomind org reload), which also reopens a closed scope with its spend kept; reassign the remaining work to a section with room; or stop the work. ' +
        "Each role's own budget_usd stays an individual soft stop.",
    });
  });

  it('reads right for the root reserve and for the org', () => {
    expect(warningNotice(reserve).subject).toBe('budget: the root reserve at 85 percent of its USD allocation');
    expect(warningNotice(reserve).body).toContain(
      'The root reserve has spent $34.00 of its USD reserve (run_config.budget_usd minus the section allocations), $40.00 (85 percent).',
    );
    expect(warningNotice(reserve).body).toContain('raise run_config.budget_usd (or lower a section allocation) and hot-reload it');
    expect(warningNotice(org).subject).toBe('budget: the org at 80 percent of its USD allocation');
    expect(warningNotice(org).body).toContain('The org has spent $80.00 of its run_config.budget_usd, $100.00 (80 percent).');
  });
});

describe('the closure notice', () => {
  it('is exact, lists the roles and the held tasks, and says it reopens on a reload', () => {
    expect(closureNotice({ ...section, spentUsd: 30.4 }, ['research-lead', 'researcher'], ['task-1', 'task-2'])).toEqual({
      subject: 'budget: section "research" is closed at its USD allocation',
      body:
        'Section "research" has spent $30.40 of its USD allocation (sections.research.budget.usd), $30.00 (101 percent), and is now soft-closed: ' +
        'its roles (research-lead, researcher) take no new work, no new task can be assigned into it, and its open tasks are held; sessions already running finish their turn. ' +
        'Held tasks: task-1, task-2. It reopens when the allocation is raised and hot-reloaded. ' +
        'Options: raise sections.research.budget.usd and hot-reload it (monomind org reload), which also reopens a closed scope with its spend kept; reassign the remaining work to a section with room; or stop the work.',
    });
  });

  it('omits the held-task sentence when nothing was held', () => {
    expect(closureNotice(section, ['a'], []).body).not.toContain('Held tasks');
  });
});

describe('the refusal, the detail and the remedy', () => {
  it('a new task into a closed section is refused with the remedy', () => {
    expect(assignmentRefusal({ ...section, spentUsd: 30 }, 'researcher')).toBe(
      'REFUSED: section "research" has spent $30.00 of its USD allocation (sections.research.budget.usd), $30.00, and is closed: no new task can be assigned to "researcher" until it reopens. ' +
        'Raise sections.research.budget.usd and hot-reload it (monomind org reload), or assign the work to a role in another section.',
    );
  });

  it('the hold reason and remedy', () => {
    expect(closureDetail({ ...section, spentUsd: 30.2 })).toBe('section "research" USD allocation exhausted ($30.20 / $30)');
    expect(closureRemedy(section)).toBe(
      'Raise sections.research.budget.usd in the org definition and hot-reload it (`monomind org reload`) — the closed roles reopen with their spend so far kept — or reassign the work to a role in another section.',
    );
    expect(scopeLabel(org)).toBe('the org');
  });

  it("the copy of a role's own warning that goes to its section lead", () => {
    expect(roleWarningCopy('"coder" has spent $17.00 of its $20 budget_usd (85%)')).toBe(
      '[budget] "coder" has spent $17.00 of its $20 budget_usd (85%). At the cap its session closes and tasks assigned to it are blocked; its role cap sits inside the section allocation, so raise budget_usd and the allocation together (hot-reload with monomind org reload), or reassign the work.',
    );
  });
});
