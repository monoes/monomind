/**
 * The browser-facing half of the accessibility check: fetch the AX tree,
 * sweep the DOM for tabindex (which the AX tree does not expose at all), and
 * turn `ax-node:<id>` placeholders into real CSS selectors a human or an
 * agent can act on. The rules themselves live in a11y.ts and stay pure.
 */

import { evaluateJs } from '../browser/actions.js';
import type { CdpClient } from '../browser/cdp.js';
import { runA11yRules } from './a11y.js';
import { buildStructure } from './structure.js';
import type { A11yFinding, AxNode, FocusCandidate, StructureNode } from './types.js';
import { message, STEP_TIMEOUT_MS, withTimeout } from './util.js';

/** Most AX findings we will spend a DOM round-trip on to get a real selector. */
const MAX_LOCATOR_LOOKUPS = 60;

/** Builds a short, stable CSS selector for an element, from inside the page. */
const LOCATOR_FN = `function(){
  var el = this;
  if (!el || el.nodeType !== 1) return '';
  var esc = function(s){ return window.CSS && CSS.escape ? CSS.escape(s) : s; };
  if (el.id) return '#' + esc(el.id);
  var parts = [], node = el, depth = 0;
  while (node && node.nodeType === 1 && depth < 5) {
    var part = node.tagName.toLowerCase();
    if (node.id) { parts.unshift('#' + esc(node.id)); break; }
    var parent = node.parentElement;
    if (parent) {
      var sibs = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
      if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
    }
    parts.unshift(part);
    node = parent;
    depth++;
  }
  return parts.join(' > ');
}`;

/** DOM sweep for tabindex — the AX tree does not expose it at all. */
const FOCUS_CANDIDATES_JS = `(function(){
  try {
    var esc = function(s){ return window.CSS && CSS.escape ? CSS.escape(s) : s; };
    var loc = function(el){
      if (el.id) return '#' + esc(el.id);
      var parts = [], node = el, depth = 0;
      while (node && node.nodeType === 1 && depth < 5) {
        var part = node.tagName.toLowerCase();
        if (node.id) { parts.unshift('#' + esc(node.id)); break; }
        var parent = node.parentElement;
        if (parent) {
          var sibs = Array.prototype.filter.call(parent.children, function(c){ return c.tagName === node.tagName; });
          if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
        depth++;
      }
      return parts.join(' > ');
    };
    var out = [];
    var els = document.querySelectorAll('[tabindex]');
    for (var i = 0; i < els.length && out.length < 100; i++) {
      var el = els[i];
      var ti = parseInt(el.getAttribute('tabindex'), 10);
      if (!(ti < 0)) continue;
      var name = (el.getAttribute('aria-label') || el.getAttribute('title') || (el.textContent || '')).trim();
      out.push({
        tag: el.tagName.toLowerCase(),
        role: (el.getAttribute('role') || '').toLowerCase(),
        name: name ? name.slice(0, 120) : null,
        tabindex: ti,
        locator: loc(el)
      });
    }
    return out;
  } catch (e) { return []; }
})()`;

async function resolveLocator(
  client: CdpClient,
  sessionId: string,
  backendNodeId: number,
): Promise<string | null> {
  try {
    const resolved = await client.send<{ object?: { objectId?: string } }>(
      'DOM.resolveNode',
      { backendNodeId },
      sessionId,
    );
    const objectId = resolved.object?.objectId;
    if (!objectId) return null;
    try {
      const call = await client.send<{ result?: { value?: string } }>(
        'Runtime.callFunctionOn',
        { functionDeclaration: LOCATOR_FN, objectId, returnByValue: true },
        sessionId,
      );
      return call.result?.value || null;
    } finally {
      await client.send('Runtime.releaseObject', { objectId }, sessionId).catch(() => {});
    }
  } catch {
    return null;
  }
}

/**
 * Rewrites `ax-node:<id>` placeholder locators into real CSS selectors.
 * Bounded: a page with 400 unlabelled buttons must not cost 400 CDP
 * round-trips, and nobody reads the 400th finding anyway.
 */
export async function upgradeLocators(
  client: CdpClient,
  sessionId: string,
  findings: A11yFinding[],
  nodes: AxNode[],
): Promise<A11yFinding[]> {
  const backendByNodeId = new Map<string, number>();
  for (const n of nodes) {
    if (n.backendDOMNodeId !== undefined) backendByNodeId.set(String(n.nodeId), n.backendDOMNodeId);
  }

  let budget = MAX_LOCATOR_LOOKUPS;
  const cache = new Map<number, string | null>();
  const out: A11yFinding[] = [];
  for (const finding of findings) {
    if (!finding.locator.startsWith('ax-node:') || budget <= 0) {
      out.push(finding);
      continue;
    }
    const backendId = backendByNodeId.get(finding.locator.slice('ax-node:'.length));
    if (backendId === undefined) {
      out.push(finding);
      continue;
    }
    if (!cache.has(backendId)) {
      budget--;
      cache.set(backendId, await resolveLocator(client, sessionId, backendId));
    }
    const selector = cache.get(backendId);
    out.push(selector ? { ...finding, locator: selector } : finding);
  }
  return out;
}

export interface A11yResult {
  findings: A11yFinding[];
  /**
   * Flat signature of the same tree, for the run-to-run structural diff. It
   * rides along here because the AX tree is already in hand — fetching it
   * twice would double the cost of the most expensive collector.
   */
  structure: StructureNode[];
}

export async function collectA11y(
  client: CdpClient,
  sessionId: string,
  notes: string[],
): Promise<A11yResult> {
  let nodes: AxNode[] = [];
  try {
    const tree = await withTimeout(
      client.send<{ nodes: AxNode[] }>('Accessibility.getFullAXTree', {}, sessionId),
      STEP_TIMEOUT_MS,
      'accessibility tree',
    );
    nodes = tree.nodes ?? [];
  } catch (err) {
    notes.push(`Accessibility tree unavailable: ${message(err)}`);
    return { findings: [], structure: [] };
  }

  let focusCandidates: FocusCandidate[] = [];
  try {
    const raw = await withTimeout(
      evaluateJs(client, sessionId, FOCUS_CANDIDATES_JS),
      STEP_TIMEOUT_MS,
      'tabindex sweep',
    );
    if (Array.isArray(raw)) focusCandidates = raw as FocusCandidate[];
  } catch (err) {
    notes.push(`Tabindex sweep skipped: ${message(err)}`);
  }

  const structure = buildStructure(nodes);
  const findings = runA11yRules({ nodes, focusCandidates });
  try {
    const upgraded = await withTimeout(
      upgradeLocators(client, sessionId, findings, nodes),
      STEP_TIMEOUT_MS,
      'locator resolution',
    );
    return { findings: upgraded, structure };
  } catch {
    notes.push('Some accessibility locators could not be resolved to CSS selectors.');
    return { findings, structure };
  }
}
