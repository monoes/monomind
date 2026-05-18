import type { CdpClient } from './cdp.js';
import type { ElementRef } from './types.js';
import { evaluateJs } from './actions.js';
import { getObjectIdForRef } from './snapshot.js';

export type FindAction = 'click' | 'fill' | 'type' | 'hover' | 'focus' | 'check' | 'uncheck' | 'text';

export interface FindOptions {
  name?: string;
  exact?: boolean;
  nth?: number;
  first?: boolean;
  last?: boolean;
}

export async function findBySelector(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  selector: string,
  options: FindOptions = {}
): Promise<ElementRef | null> {
  if (options.nth !== undefined && options.nth < 1) {
    throw new Error(`nth must be >= 1 (received ${options.nth})`);
  }
  try {
    const doc = await client.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, sessionId);

    let targetNodeId: number;
    if (options.nth !== undefined || options.last) {
      const result = await client.send<{ nodeIds: number[] }>(
        'DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector }, sessionId
      );
      const nodeIds = result.nodeIds ?? [];
      if (nodeIds.length === 0) return null;
      targetNodeId = options.last ? nodeIds[nodeIds.length - 1] : (nodeIds[(options.nth ?? 1) - 1] ?? 0);
    } else {
      const result = await client.send<{ nodeId: number }>(
        'DOM.querySelector', { nodeId: doc.root.nodeId, selector }, sessionId
      );
      targetNodeId = result.nodeId ?? 0;
    }

    if (!targetNodeId) return null;

    const desc = await client.send<{ node: { backendNodeId: number } }>(
      'DOM.describeNode', { nodeId: targetNodeId }, sessionId
    );
    const backendDOMNodeId = desc.node?.backendNodeId;
    if (!backendDOMNodeId) return null;

    // Return existing ref from snapshot if this node is already indexed
    const existing = [...refs.values()].find((r) => r.backendDOMNodeId === backendDOMNodeId);
    if (existing) return existing;

    // Synthetic ref for elements not represented in the AX tree — insert into refs so it can be used in subsequent commands
    const syntheticRef: ElementRef = { ref: `sel-${backendDOMNodeId}`, role: 'generic', name: selector, nodeId: targetNodeId, backendDOMNodeId };
    refs.set(syntheticRef.ref, syntheticRef);
    return syntheticRef;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/invalid|illegal|SyntaxError/i.test(msg)) throw err;
    return null;
  }
}

export async function findByRole(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  role: string,
  options: FindOptions = {}
): Promise<ElementRef | null> {
  if (options.nth !== undefined && options.nth < 1) {
    throw new Error(`nth must be >= 1 (received ${options.nth})`);
  }
  const lowerRole = role.toLowerCase();
  const candidates = [...refs.values()].filter((r) => r.role.toLowerCase() === lowerRole);

  let matches = candidates;
  if (options.name) {
    const nameLower = options.name.toLowerCase();
    matches = options.exact
      ? candidates.filter((r) => r.name.toLowerCase() === nameLower)
      : candidates.filter((r) => r.name.toLowerCase().includes(nameLower));
  }

  if (matches.length === 0) return null;
  if (options.nth !== undefined) return matches[options.nth - 1] ?? null;
  if (options.last) return matches[matches.length - 1];
  return matches[0];
}

export async function findByText(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  text: string,
  options: FindOptions = {}
): Promise<ElementRef | null> {
  if (options.nth !== undefined && options.nth < 1) {
    throw new Error(`nth must be >= 1 (received ${options.nth})`);
  }
  const lower = text.toLowerCase();
  const candidates = [...refs.values()].filter((r) =>
    options.exact ? r.name.toLowerCase() === lower : r.name.toLowerCase().includes(lower)
  );
  if (options.nth !== undefined) return candidates[options.nth - 1] ?? null;
  if (options.last) return candidates[candidates.length - 1] ?? null;
  return candidates[0] ?? null;
}

export async function findByLabel(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  label: string,
  options: FindOptions = {}
): Promise<ElementRef | null> {
  return findByText(client, sessionId, refs, label, options);
}

export async function findByPlaceholder(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  placeholder: string,
  options: FindOptions = {}
): Promise<ElementRef | null> {
  if (options.nth !== undefined && options.nth < 1) {
    throw new Error(`nth must be >= 1 (received ${options.nth})`);
  }
  const lower = placeholder.toLowerCase();
  const candidates = [...refs.values()].filter((r) => {
    const ph = (r.placeholder ?? '').toLowerCase();
    return options.exact ? ph === lower : ph.includes(lower);
  });
  if (options.nth !== undefined) return candidates[options.nth - 1] ?? null;
  if (options.last) return candidates[candidates.length - 1] ?? null;
  return candidates[0] ?? null;
}

export async function findByTestId(
  client: CdpClient,
  sessionId: string,
  testId: string
): Promise<string | null> {
  const escapedId = testId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const selectors = [
    `[data-testid="${escapedId}"]`,
    `[data-test-id="${escapedId}"]`,
    `[data-test="${escapedId}"]`,
  ];
  for (const sel of selectors) {
    const result = await evaluateJs(client, sessionId, `!!document.querySelector(${JSON.stringify(sel)})`);
    if (result) return sel;
  }
  return null;
}

export async function isVisible(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) return false;

  const result = await client.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
    functionDeclaration: `function() {
      const rect = this.getBoundingClientRect();
      const style = window.getComputedStyle(this);
      return rect.width > 0 && rect.height > 0 &&
             style.display !== 'none' &&
             style.visibility !== 'hidden' &&
             style.opacity !== '0';
    }`,
    objectId,
    returnByValue: true,
  }, sessionId);
  return result.result?.value ?? false;
}

export async function isEnabled(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean> {
  return !ref.disabled;
}

export async function isChecked(client: CdpClient, sessionId: string, ref: ElementRef): Promise<boolean> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) return false;

  const result = await client.send<{ result: { value?: boolean } }>('Runtime.callFunctionOn', {
    functionDeclaration: 'function() { return !!this.checked; }',
    objectId,
    returnByValue: true,
  }, sessionId);
  return result.result?.value ?? false;
}

export async function scrollIntoView(client: CdpClient, sessionId: string, ref: ElementRef): Promise<void> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) throw new Error(`Cannot scroll: ref @${ref.ref} not found in DOM`);

  await client.send('Runtime.callFunctionOn', {
    functionDeclaration: 'function() { this.scrollIntoView({ behavior: "smooth", block: "center" }); }',
    objectId,
    returnByValue: true,
  }, sessionId);
}

export async function highlightElement(client: CdpClient, sessionId: string, ref: ElementRef): Promise<void> {
  const objectId = await getObjectIdForRef(client, sessionId, ref);
  if (!objectId) return;

  await client.send('Runtime.callFunctionOn', {
    functionDeclaration: `function() {
      const prev = this.style.outline;
      const prevBg = this.style.backgroundColor;
      this.style.outline = '3px solid #ff5722';
      this.style.backgroundColor = 'rgba(255, 87, 34, 0.1)';
      setTimeout(() => {
        this.style.outline = prev;
        this.style.backgroundColor = prevBg;
      }, 2000);
    }`,
    objectId,
    returnByValue: true,
  }, sessionId);
}
