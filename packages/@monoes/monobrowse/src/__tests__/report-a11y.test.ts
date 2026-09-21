/**
 * The a11y rules are pure functions over a CDP accessibility tree, so the
 * fixtures here are hand-written AX node arrays — no Chrome involved.
 */
import { describe, expect, it } from 'vitest';
import {
  countA11y,
  findFocusOrderIssues,
  findHeadingIssues,
  findNamingIssues,
  orderNodes,
  runA11yRules,
} from '../report/a11y.js';
import type { AxNode, FocusCandidate } from '../report/types.js';

function node(partial: Partial<AxNode> & { nodeId: string | number }): AxNode {
  return partial as AxNode;
}

function ax(nodeId: string | number, role: string, name = '', extra: Partial<AxNode> = {}): AxNode {
  return node({ nodeId, role: { value: role }, name: { value: name }, ...extra });
}

function heading(nodeId: string | number, level: number, name = `h${level}`): AxNode {
  return node({
    nodeId,
    role: { value: 'heading' },
    name: { value: name },
    properties: [{ name: 'level', value: { value: level } }],
  });
}

describe('findNamingIssues', () => {
  it('flags a button with no accessible name', () => {
    const findings = findNamingIssues([ax(1, 'button', '')]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'unlabelled-control',
      impact: 'error',
      role: 'button',
      name: null,
      locator: 'ax-node:1',
    });
  });

  it('leaves named controls alone, including whitespace-trimmed names', () => {
    expect(findNamingIssues([ax(1, 'button', 'Save'), ax(2, 'link', 'Home')])).toEqual([]);
  });

  it('treats a whitespace-only name as no name', () => {
    expect(findNamingIssues([ax(1, 'link', '   ')])).toHaveLength(1);
  });

  it('reports an unlabelled form field under its own rule, not unlabelled-control', () => {
    const findings = findNamingIssues([ax(1, 'textbox', '')]);
    expect(findings[0].rule).toBe('form-field-no-label');
    expect(findings[0].impact).toBe('error');
  });

  it('flags an image with no alt text', () => {
    const findings = findNamingIssues([ax(1, 'image', '')]);
    expect(findings[0].rule).toBe('image-missing-alt');
  });

  it('does not flag a decorative image, which the AX tree marks ignored', () => {
    expect(findNamingIssues([ax(1, 'image', '', { ignored: true })])).toEqual([]);
  });

  it('uses a resolved CSS selector as the locator when one is supplied', () => {
    const locators = new Map([[42, '#submit']]);
    const findings = findNamingIssues([ax(1, 'button', '', { backendDOMNodeId: 42 })], locators);
    expect(findings[0].locator).toBe('#submit');
  });

  it('ignores roles that carry no naming requirement', () => {
    expect(findNamingIssues([ax(1, 'paragraph', ''), ax(2, 'generic', '')])).toEqual([]);
  });
});

describe('findHeadingIssues', () => {
  it('flags a skipped heading level', () => {
    const findings = findHeadingIssues([heading(1, 1), heading(2, 3)]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('heading-order-jump');
    expect(findings[0].impact).toBe('warning');
    expect(findings[0].detail).toContain('h1 -> h3');
  });

  it('accepts a well-formed outline, including going back up a level', () => {
    expect(findHeadingIssues([heading(1, 1), heading(2, 2), heading(3, 3), heading(4, 2)])).toEqual(
      [],
    );
  });

  it('flags a document whose first heading is not h1', () => {
    const findings = findHeadingIssues([heading(1, 2)]);
    expect(findings[0].detail).toContain('starts at h2');
  });

  it('reads levels in document order, not array order', () => {
    // Array order says h1, h3, h2 (a jump); tree order says h1, h2, h3 (fine).
    const nodes = [
      node({ nodeId: 'root', role: { value: 'main' }, childIds: ['a', 'c', 'b'] }),
      { ...heading('b', 3), parentId: 'root' },
      { ...heading('a', 1), parentId: 'root' },
      { ...heading('c', 2), parentId: 'root' },
    ];
    expect(findHeadingIssues(nodes)).toEqual([]);
  });

  it('skips headings with no usable level property', () => {
    expect(findHeadingIssues([ax(1, 'heading', 'Untitled')])).toEqual([]);
  });
});

describe('orderNodes', () => {
  it('walks childIds depth-first and keeps unreachable nodes rather than dropping them', () => {
    const nodes = [
      node({ nodeId: 'r', childIds: ['x'] }),
      node({ nodeId: 'x', parentId: 'r', childIds: ['y'] }),
      node({ nodeId: 'y', parentId: 'x' }),
      node({ nodeId: 'orphan', parentId: 'gone' }),
    ];
    expect(orderNodes(nodes).map((n) => n.nodeId)).toEqual(['r', 'x', 'y', 'orphan']);
  });

  it('does not loop forever on a cyclic tree', () => {
    const nodes = [
      node({ nodeId: 'a', childIds: ['b'] }),
      node({ nodeId: 'b', parentId: 'a', childIds: ['a'] }),
    ];
    expect(orderNodes(nodes)).toHaveLength(2);
  });
});

describe('findFocusOrderIssues', () => {
  const candidate = (partial: Partial<FocusCandidate>): FocusCandidate => ({
    tag: 'button',
    role: '',
    name: 'Next',
    tabindex: -1,
    locator: '#next',
    ...partial,
  });

  it('flags a natively focusable element taken out of the tab order', () => {
    const findings = findFocusOrderIssues([candidate({})]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'negative-tabindex', impact: 'warning' });
    expect(findings[0].detail).toContain('tabindex="-1"');
  });

  it('ignores non-negative tabindex', () => {
    expect(findFocusOrderIssues([candidate({ tabindex: 0 })])).toEqual([]);
  });

  it('ignores a plain container that is merely script-focusable', () => {
    expect(findFocusOrderIssues([candidate({ tag: 'div', role: '' })])).toEqual([]);
  });

  it('flags a div that claims an interactive role', () => {
    expect(findFocusOrderIssues([candidate({ tag: 'div', role: 'button' })])).toHaveLength(1);
  });
});

describe('runA11yRules', () => {
  it('combines every rule and counts errors separately from warnings', () => {
    const findings = runA11yRules({
      nodes: [ax(1, 'button', ''), ax(2, 'image', ''), heading(3, 1), heading(4, 4)],
      focusCandidates: [{ tag: 'a', role: '', name: 'Skip', tabindex: -1, locator: '#skip' }],
    });
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'heading-order-jump',
      'image-missing-alt',
      'negative-tabindex',
      'unlabelled-control',
    ]);
    expect(countA11y(findings)).toEqual({ errors: 2, warnings: 2 });
  });
});
