import type { CdpClient } from './cdp.js';
import type { ElementRef, SnapshotOptions, SnapshotResult } from './types.js';
import { INTERACTIVE_ROLES } from './types.js';
import { getCurrentUrl, getCurrentTitle } from './browser.js';

interface AXNode {
  nodeId: number;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: Array<{ name: string; value: { value: unknown } }>;
  backendDOMNodeId?: number;
  parentId?: number;
  childIds?: number[];
  ignored?: boolean;
  ignoredReasons?: unknown[];
}

export async function captureSnapshot(
  client: CdpClient,
  sessionId: string,
  options: SnapshotOptions = {}
): Promise<SnapshotResult> {
  const { interactiveOnly = false, compact = false, maxDepth, selector } = options;

  // If a selector scope is requested, resolve it to a backendDOMNodeId and use getPartialAXTree
  let nodes: AXNode[];
  if (selector) {
    const doc = await client.send<{ root: { nodeId: number } }>('DOM.getDocument', {}, sessionId);
    const found = await client.send<{ nodeId: number }>(
      'DOM.querySelector',
      { nodeId: doc.root.nodeId, selector },
      sessionId
    ).catch(() => ({ nodeId: 0 }));

    if (found.nodeId) {
      const partial = await client.send<{ nodes: AXNode[] }>(
        'Accessibility.getPartialAXTree',
        { nodeId: found.nodeId, fetchRelatives: false },
        sessionId
      ).catch(async () => client.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree', {}, sessionId));
      nodes = partial.nodes;
    } else {
      const full = await client.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree', {}, sessionId);
      nodes = full.nodes;
    }
  } else {
    const full = await client.send<{ nodes: AXNode[] }>('Accessibility.getFullAXTree', {}, sessionId);
    nodes = full.nodes;
  }

  const url = await getCurrentUrl(client, sessionId);
  const title = await getCurrentTitle(client, sessionId);

  const refs = new Map<string, ElementRef>();
  const nodeMap = new Map<number, AXNode>();
  for (const node of nodes) nodeMap.set(node.nodeId, node);

  let refCounter = 1;
  const lines: string[] = [];

  const processNode = (node: AXNode, depth: number) => {
    // Transparent/structural nodes don't consume depth budget — check before maxDepth
    if (node.ignored) {
      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId);
          if (child) processNode(child, depth);
        }
      }
      return;
    }

    const role = node.role?.value ?? 'generic';

    if (role === 'none' || role === 'generic' || role === 'inlineTextBox') {
      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId);
          if (child) processNode(child, depth);
        }
      }
      return;
    }

    // Only enforce maxDepth for real rendered roles
    if (maxDepth !== undefined && depth > maxDepth) return;

    const name = node.name?.value ?? '';
    const description = node.description?.value;

    const isInteractive = INTERACTIVE_ROLES.has(role.toLowerCase());

    if (interactiveOnly && !isInteractive) {
      if (node.childIds) {
        for (const childId of node.childIds) {
          const child = nodeMap.get(childId);
          if (child) processNode(child, depth);
        }
      }
      return;
    }

    const props = extractProperties(node);
    const refKey = `e${refCounter++}`;
    const elemRef: ElementRef = {
      ref: refKey,
      role,
      name,
      description,
      placeholder: props.placeholder,
      value: props.value,
      disabled: props.disabled,
      checked: props.checked,
      expanded: props.expanded,
      nodeId: node.nodeId,
      backendDOMNodeId: node.backendDOMNodeId,
    };
    refs.set(refKey, elemRef);

    const indent = compact ? '' : '  '.repeat(depth);
    const attrParts: string[] = [`ref=${refKey}`];
    if (props.value !== undefined) attrParts.push(`value="${props.value}"`);
    if (props.disabled) attrParts.push('disabled');
    if (props.checked !== undefined) attrParts.push(`checked=${props.checked}`);
    if (props.expanded !== undefined) attrParts.push(`expanded=${props.expanded}`);
    if (props.placeholder) attrParts.push(`placeholder="${props.placeholder}"`);
    if (props.required) attrParts.push('required');

    const nameStr = name ? ` "${name}"` : '';
    const descStr = description && !compact ? ` (${description})` : '';
    const attrsStr = ` [${attrParts.join(', ')}]`;

    lines.push(`${indent}${role}${nameStr}${descStr}${attrsStr}`);

    if (node.childIds) {
      for (const childId of node.childIds) {
        const child = nodeMap.get(childId);
        if (child) processNode(child, depth + 1);
      }
    }
  };

  // Find root nodes — for partial trees parentId may point outside the set; use filter to handle forests
  const ids = new Set(nodes.map((n) => n.nodeId));
  const roots = nodes.filter((n) => n.parentId === undefined || !ids.has(n.parentId));
  for (const root of roots) processNode(root, 0);

  return { text: lines.join('\n'), refs, url, title };
}

function extractProperties(node: AXNode): {
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  expanded?: boolean;
  placeholder?: string;
  required?: boolean;
} {
  const result: ReturnType<typeof extractProperties> = {};
  if (!node.properties) return result;

  for (const prop of node.properties) {
    switch (prop.name) {
      case 'value':
        if (prop.value.value != null) result.value = String(prop.value.value);
        break;
      case 'disabled':
        result.disabled = Boolean(prop.value.value);
        break;
      case 'checked':
        result.checked = prop.value.value === 'true' || prop.value.value === true;
        break;
      case 'expanded':
        result.expanded = prop.value.value === 'true' || prop.value.value === true;
        break;
      case 'placeholder':
        result.placeholder = String(prop.value.value ?? '');
        break;
      case 'required':
        result.required = Boolean(prop.value.value);
        break;
    }
  }

  if (node.value?.value !== undefined && result.value === undefined) {
    result.value = String(node.value.value);
  }

  return result;
}

export async function resolveRef(
  client: CdpClient,
  sessionId: string,
  refs: Map<string, ElementRef>,
  refKey: string
): Promise<ElementRef> {
  const ref = refs.get(refKey);
  if (!ref) throw new Error(`Element ref @${refKey} not found. Run snapshot first.`);
  return ref;
}

export async function getObjectIdForRef(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef
): Promise<string | null> {
  if (!ref.backendDOMNodeId) return null;

  const result = await client.send<{ object: { objectId?: string } }>(
    'DOM.resolveNode',
    { backendNodeId: ref.backendDOMNodeId },
    sessionId
  );
  return result.object?.objectId ?? null;
}

export async function getElementBox(
  client: CdpClient,
  sessionId: string,
  ref: ElementRef
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (!ref.backendDOMNodeId) return null;

  try {
    const result = await client.send<{
      model: {
        content: number[];
        border: number[];
        margin: number[];
        padding: number[];
        width: number;
        height: number;
      };
    }>('DOM.getBoxModel', { backendNodeId: ref.backendDOMNodeId }, sessionId);

    const content = result.model?.content;
    if (!content || content.length < 8) return null;

    const x = (content[0] + content[2] + content[4] + content[6]) / 4;
    const y = (content[1] + content[3] + content[5] + content[7]) / 4;
    return { x, y, width: result.model.width, height: result.model.height };
  } catch {
    return null;
  }
}
