/**
 * Accessibility rules computed from the CDP accessibility tree.
 *
 * Deliberate scope limit: colour contrast is NOT computed here. Contrast
 * needs resolved foreground/background pixels or computed styles, and the AX
 * tree carries neither — guessing it would produce confident nonsense. The
 * report says so explicitly instead.
 *
 * Every rule is a pure function of a node array, so the fixtures in the tests
 * are just hand-written AX trees.
 */

import type { A11yFinding, AxNode, FocusCandidate } from './types.js';

/** Roles whose whole purpose is to be activated — a nameless one is unusable. */
const COMMAND_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'treeitem',
]);

/** Roles that take user input and therefore need a programmatic label. */
const FORM_FIELD_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'checkbox',
  'radio',
  'slider',
  'spinbutton',
]);

const IMAGE_ROLES = new Set(['image', 'img']);

/** Natively focusable tags — a negative tabindex on these removes them from the tab order. */
const NATIVELY_FOCUSABLE = new Set(['a', 'button', 'input', 'select', 'textarea', 'summary']);

function strValue(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function roleOf(node: AxNode): string {
  return strValue(node.role?.value).toLowerCase();
}

function nameOf(node: AxNode): string {
  return strValue(node.name?.value).trim();
}

function propOf(node: AxNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value?.value;
}

function locatorFor(node: AxNode, locators?: Map<number, string>): string {
  if (node.backendDOMNodeId !== undefined) {
    const found = locators?.get(node.backendDOMNodeId);
    if (found) return found;
  }
  return `ax-node:${node.nodeId}`;
}

/**
 * Depth-first document order. `Accessibility.getFullAXTree` usually returns
 * nodes pre-ordered already, but heading-order is the one rule where a
 * reordered array would silently produce wrong findings, so we walk childIds
 * ourselves. Nodes unreachable from a root are appended in array order rather
 * than dropped.
 */
export function orderNodes(nodes: AxNode[]): AxNode[] {
  const byId = new Map<string, AxNode>();
  for (const n of nodes) byId.set(String(n.nodeId), n);

  const ids = new Set(byId.keys());
  const roots = nodes.filter((n) => n.parentId === undefined || !ids.has(String(n.parentId)));

  const seen = new Set<string>();
  const ordered: AxNode[] = [];
  const visit = (node: AxNode): void => {
    const id = String(node.nodeId);
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(node);
    for (const childId of node.childIds ?? []) {
      const child = byId.get(String(childId));
      if (child) visit(child);
    }
  };
  for (const root of roots) visit(root);
  for (const node of nodes) if (!seen.has(String(node.nodeId))) ordered.push(node);
  return ordered;
}

/**
 * Nameless controls, images without alt text, and unlabelled form fields.
 *
 * `ignored` nodes are skipped: that is how `<img alt="">` correctly escapes
 * the image rule — a deliberately decorative image is dropped from the AX
 * tree, while `<img>` with no alt attribute at all stays in it with an empty
 * name, which is the bug we want to report.
 */
export function findNamingIssues(nodes: AxNode[], locators?: Map<number, string>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  for (const node of nodes) {
    if (node.ignored) continue;
    const role = roleOf(node);
    if (!role) continue;
    const name = nameOf(node);
    if (name) continue;

    if (FORM_FIELD_ROLES.has(role)) {
      findings.push({
        rule: 'form-field-no-label',
        impact: 'error',
        role,
        name: null,
        locator: locatorFor(node, locators),
        detail: `${role} has no accessible name — no <label>, aria-label or aria-labelledby resolves to one`,
      });
      continue;
    }

    if (COMMAND_ROLES.has(role)) {
      findings.push({
        rule: 'unlabelled-control',
        impact: 'error',
        role,
        name: null,
        locator: locatorFor(node, locators),
        detail: `${role} has no accessible name — a screen reader announces it as just "${role}"`,
      });
      continue;
    }

    if (IMAGE_ROLES.has(role)) {
      findings.push({
        rule: 'image-missing-alt',
        impact: 'error',
        role,
        name: null,
        locator: locatorFor(node, locators),
        detail: 'image has no alt text (use alt="" if it is purely decorative)',
      });
    }
  }
  return findings;
}

/**
 * Headings that skip a level (h1 -> h3), plus a document whose first heading
 * is not h1. Both break the outline screen-reader users navigate by.
 */
export function findHeadingIssues(nodes: AxNode[], locators?: Map<number, string>): A11yFinding[] {
  const findings: A11yFinding[] = [];
  let previous: number | null = null;

  for (const node of orderNodes(nodes)) {
    if (node.ignored) continue;
    if (roleOf(node) !== 'heading') continue;
    const raw = propOf(node, 'level');
    const level = typeof raw === 'number' ? raw : Number.parseInt(strValue(raw), 10);
    if (!Number.isFinite(level) || level < 1) continue;

    const name = nameOf(node);
    if (previous === null) {
      if (level > 1) {
        findings.push({
          rule: 'heading-order-jump',
          impact: 'warning',
          role: 'heading',
          name: name || null,
          locator: locatorFor(node, locators),
          detail: `document outline starts at h${level} — the first heading should be h1`,
        });
      }
    } else if (level > previous + 1) {
      findings.push({
        rule: 'heading-order-jump',
        impact: 'warning',
        role: 'heading',
        name: name || null,
        locator: locatorFor(node, locators),
        detail: `heading level jumps h${previous} -> h${level}`,
      });
    }
    previous = level;
  }
  return findings;
}

/**
 * Interactive elements pulled out of the keyboard tab order by a negative
 * tabindex. They stay clickable with a mouse and stay in the AX tree, so
 * nothing else in this file can see them — the candidates come from a DOM
 * sweep in collect.ts.
 */
export function findFocusOrderIssues(candidates: FocusCandidate[]): A11yFinding[] {
  const findings: A11yFinding[] = [];
  for (const c of candidates) {
    if (c.tabindex >= 0) continue;
    const interactive = NATIVELY_FOCUSABLE.has(c.tag.toLowerCase()) || c.role !== '';
    if (!interactive) continue;
    findings.push({
      rule: 'negative-tabindex',
      impact: 'warning',
      role: c.role || c.tag.toLowerCase(),
      name: c.name,
      locator: c.locator,
      detail: `<${c.tag.toLowerCase()}> has tabindex="${c.tabindex}" — mouse users can reach it, keyboard users cannot`,
    });
  }
  return findings;
}

export interface A11yInput {
  nodes: AxNode[];
  focusCandidates?: FocusCandidate[];
  locators?: Map<number, string>;
}

export function runA11yRules({ nodes, focusCandidates = [], locators }: A11yInput): A11yFinding[] {
  return [
    ...findNamingIssues(nodes, locators),
    ...findHeadingIssues(nodes, locators),
    ...findFocusOrderIssues(focusCandidates),
  ];
}

export function countA11y(findings: A11yFinding[]): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const f of findings) {
    if (f.impact === 'error') errors++;
    else warnings++;
  }
  return { errors, warnings };
}
