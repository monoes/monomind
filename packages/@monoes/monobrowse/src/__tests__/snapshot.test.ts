/**
 * captureSnapshot turns a CDP accessibility tree into the indented ref-tagged
 * text the agent actually reads, and into the ref Map every later command
 * resolves against. That transform is pure — the only browser interaction is
 * the AX-tree fetch, which a stub answers from a literal node array.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import { captureSnapshot, resolveRef, getObjectIdForRef, getElementBox } from '../browser/snapshot.js';
import type { ElementRef } from '../browser/types.js';

interface AXProp {
  name: string;
  value: { value: unknown };
}
interface AXNode {
  nodeId: number;
  role?: { value: string };
  name?: { value: string };
  description?: { value: string };
  value?: { value: string };
  properties?: AXProp[];
  backendDOMNodeId?: number;
  parentId?: number;
  childIds?: number[];
  ignored?: boolean;
}

/** Client that serves a fixed AX tree plus location.href / document.title. */
function axClient(
  nodes: AXNode[],
  extra: { url?: string; title?: string; partial?: AXNode[]; selectorNodeId?: number } = {}
): { client: CdpClient; calls: string[] } {
  const calls: string[] = [];
  const client = {
    send: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push(method);
      switch (method) {
        case 'Accessibility.getFullAXTree':
          return { nodes };
        case 'Accessibility.getPartialAXTree':
          return { nodes: extra.partial ?? nodes };
        case 'DOM.getDocument':
          return { root: { nodeId: 1 } };
        case 'DOM.querySelector':
          return { nodeId: extra.selectorNodeId ?? 0 };
        case 'Runtime.evaluate':
          return {
            result: {
              value:
                (params as { expression: string }).expression === 'location.href'
                  ? extra.url ?? 'https://x.test/'
                  : extra.title ?? 'Test Page',
            },
          };
        default:
          return {};
      }
    }),
  } as unknown as CdpClient;
  return { client, calls };
}

const button = (id: number, name: string, over: Partial<AXNode> = {}): AXNode => ({
  nodeId: id,
  role: { value: 'button' },
  name: { value: name },
  backendDOMNodeId: id * 10,
  ...over,
});

describe('captureSnapshot — tree shape', () => {
  it('emits one indented line per rendered node and a matching ref map', async () => {
    const { client } = axClient([
      { nodeId: 1, role: { value: 'RootWebArea' }, name: { value: 'Test Page' }, childIds: [2] },
      { nodeId: 2, role: { value: 'form' }, name: { value: 'Login' }, parentId: 1, childIds: [3] },
      button(3, 'Submit', { parentId: 2 }),
    ]);
    const snap = await captureSnapshot(client, 'S1');
    expect(snap.text).toBe(
      'RootWebArea "Test Page" [ref=e1]\n' +
        '  form "Login" [ref=e2]\n' +
        '    button "Submit" [ref=e3]'
    );
    expect([...snap.refs.keys()]).toEqual(['e1', 'e2', 'e3']);
    expect(snap.refs.get('e3')).toMatchObject({ role: 'button', name: 'Submit', backendDOMNodeId: 30 });
    expect(snap).toMatchObject({ url: 'https://x.test/', title: 'Test Page' });
  });

  it('numbers refs sequentially in document order', async () => {
    const { client } = axClient([
      { nodeId: 1, role: { value: 'RootWebArea' }, name: { value: '' }, childIds: [2, 3] },
      button(2, 'A', { parentId: 1 }),
      button(3, 'B', { parentId: 1 }),
    ]);
    const snap = await captureSnapshot(client, 'S1');
    expect(snap.refs.get('e2')!.name).toBe('A');
    expect(snap.refs.get('e3')!.name).toBe('B');
  });

  it('flattens generic/none/inlineTextBox wrappers without consuming an indent level', async () => {
    const { client } = axClient([
      { nodeId: 1, role: { value: 'RootWebArea' }, name: { value: '' }, childIds: [2] },
      { nodeId: 2, role: { value: 'generic' }, parentId: 1, childIds: [3] },
      { nodeId: 3, role: { value: 'none' }, parentId: 2, childIds: [4] },
      button(4, 'Deep', { parentId: 3 }),
    ]);
    const snap = await captureSnapshot(client, 'S1');
    // The button sits one level under the root despite two wrappers between.
    expect(snap.text).toBe('RootWebArea [ref=e1]\n  button "Deep" [ref=e2]');
  });

  it('descends through ignored nodes without emitting or numbering them', async () => {
    const { client } = axClient([
      { nodeId: 1, role: { value: 'RootWebArea' }, name: { value: '' }, childIds: [2] },
      { nodeId: 2, ignored: true, role: { value: 'button' }, parentId: 1, childIds: [3] },
      button(3, 'Visible', { parentId: 2 }),
    ]);
    const snap = await captureSnapshot(client, 'S1');
    expect([...snap.refs.values()].map((r) => r.name)).toEqual(['', 'Visible']);
  });

  it('handles a forest whose parentId points outside the returned node set', async () => {
    const { client } = axClient([
      button(5, 'Orphan A', { parentId: 999 }),
      button(6, 'Orphan B', { parentId: 998 }),
    ]);
    const snap = await captureSnapshot(client, 'S1');
    expect(snap.text.split('\n')).toHaveLength(2);
    expect(snap.text).not.toMatch(/^ /m);
  });

  it('returns empty text and no refs for an empty tree', async () => {
    const { client } = axClient([]);
    const snap = await captureSnapshot(client, 'S1');
    expect(snap.text).toBe('');
    expect(snap.refs.size).toBe(0);
  });
});

describe('captureSnapshot — options', () => {
  const page: AXNode[] = [
    { nodeId: 1, role: { value: 'RootWebArea' }, name: { value: 'P' }, childIds: [2] },
    { nodeId: 2, role: { value: 'main' }, name: { value: '' }, parentId: 1, childIds: [3, 4] },
    button(3, 'Go', { parentId: 2 }),
    { nodeId: 4, role: { value: 'paragraph' }, name: { value: 'text' }, parentId: 2 },
  ];

  it('interactiveOnly keeps interactive roles but still walks past containers', async () => {
    const { client } = axClient(page);
    const snap = await captureSnapshot(client, 'S1', { interactiveOnly: true });
    expect([...snap.refs.values()].map((r) => r.role)).toEqual(['button']);
    // Skipped containers recurse with the SAME depth, so the surviving
    // interactive nodes come out flat rather than indented by the levels of
    // markup that were filtered away.
    expect(snap.text).toBe('button "Go" [ref=e1]');
  });

  it('compact drops indentation and descriptions', async () => {
    const { client } = axClient([
      button(1, 'Go', { description: { value: 'primary action' } }),
    ]);
    const spaced = await captureSnapshot(client, 'S1');
    expect(spaced.text).toBe('button "Go" (primary action) [ref=e1]');

    const { client: c2 } = axClient([button(1, 'Go', { description: { value: 'primary action' } })]);
    const compact = await captureSnapshot(c2, 'S1', { compact: true });
    expect(compact.text).toBe('button "Go" [ref=e1]');
    // The description is still available on the ref even when not printed.
    expect(compact.refs.get('e1')!.description).toBe('primary action');
  });

  it('maxDepth prunes nodes below the budget', async () => {
    const { client } = axClient(page);
    const snap = await captureSnapshot(client, 'S1', { maxDepth: 1 });
    expect([...snap.refs.values()].map((r) => r.role)).toEqual(['RootWebArea', 'main']);
  });

  it('a selector scope uses getPartialAXTree when the selector resolves', async () => {
    const { client, calls } = axClient(page, {
      selectorNodeId: 42,
      partial: [button(7, 'Scoped')],
    });
    const snap = await captureSnapshot(client, 'S1', { selector: '#form' });
    expect(calls).toContain('Accessibility.getPartialAXTree');
    expect(calls).not.toContain('Accessibility.getFullAXTree');
    expect(snap.text).toBe('button "Scoped" [ref=e1]');
  });

  it('a selector that matches nothing falls back to the full tree', async () => {
    const { client, calls } = axClient(page, { selectorNodeId: 0 });
    await captureSnapshot(client, 'S1', { selector: '#nope' });
    expect(calls).toContain('Accessibility.getFullAXTree');
    expect(calls).not.toContain('Accessibility.getPartialAXTree');
  });
});

describe('captureSnapshot — property extraction and rendering', () => {
  async function snapOf(props: AXProp[], over: Partial<AXNode> = {}) {
    const { client } = axClient([
      { nodeId: 1, role: { value: 'textbox' }, name: { value: 'Email' }, properties: props, ...over },
    ]);
    return captureSnapshot(client, 'S1');
  }

  it('renders value, placeholder and required', async () => {
    const snap = await snapOf([
      { name: 'value', value: { value: 'a@b.c' } },
      { name: 'placeholder', value: { value: 'you@example.com' } },
      { name: 'required', value: { value: true } },
    ]);
    expect(snap.text).toBe(
      'textbox "Email" [ref=e1, value="a@b.c", placeholder="you@example.com", required]'
    );
    expect(snap.refs.get('e1')).toMatchObject({ value: 'a@b.c', placeholder: 'you@example.com' });
  });

  it('renders disabled as a bare flag only when true', async () => {
    expect((await snapOf([{ name: 'disabled', value: { value: true } }])).text).toContain(', disabled]');
    expect((await snapOf([{ name: 'disabled', value: { value: false } }])).text).not.toContain('disabled');
  });

  it('accepts checked/expanded as either the boolean or the string "true"', async () => {
    const asString = await snapOf([
      { name: 'checked', value: { value: 'true' } },
      { name: 'expanded', value: { value: 'true' } },
    ]);
    expect(asString.refs.get('e1')).toMatchObject({ checked: true, expanded: true });

    const asBool = await snapOf([
      { name: 'checked', value: { value: true } },
      { name: 'expanded', value: { value: false } },
    ]);
    expect(asBool.refs.get('e1')).toMatchObject({ checked: true, expanded: false });
    // false is still rendered — the distinction from "absent" matters.
    expect(asBool.text).toContain('expanded=false');
  });

  it('treats CDP\'s "mixed" checkbox state as not-checked', async () => {
    const snap = await snapOf([{ name: 'checked', value: { value: 'mixed' } }]);
    expect(snap.refs.get('e1')!.checked).toBe(false);
  });

  it('ignores a null property value rather than stringifying it', async () => {
    const snap = await snapOf([{ name: 'value', value: { value: null } }]);
    expect(snap.refs.get('e1')!.value).toBeUndefined();
    expect(snap.text).not.toContain('value=');
  });

  it('falls back to node.value when no value property is present', async () => {
    const snap = await snapOf([], { value: { value: 'from-node' } });
    expect(snap.refs.get('e1')!.value).toBe('from-node');
  });

  it('prefers the value property over node.value', async () => {
    const snap = await snapOf([{ name: 'value', value: { value: 'from-prop' } }], {
      value: { value: 'from-node' },
    });
    expect(snap.refs.get('e1')!.value).toBe('from-prop');
  });

  it('ignores unrecognized properties', async () => {
    const snap = await snapOf([{ name: 'invalid', value: { value: true } }]);
    expect(snap.text).toBe('textbox "Email" [ref=e1]');
  });

  it('omits the quoted name entirely when the node is unnamed', async () => {
    const { client } = axClient([{ nodeId: 1, role: { value: 'button' }, name: { value: '' } }]);
    expect((await captureSnapshot(client, 'S1')).text).toBe('button [ref=e1]');
  });

  it('defaults a role-less node to generic, which flattens it away', async () => {
    const { client } = axClient([{ nodeId: 1, name: { value: 'x' } }]);
    expect((await captureSnapshot(client, 'S1')).text).toBe('');
  });
});

describe('resolveRef', () => {
  it('returns the ref when present', () => {
    const refs = new Map<string, ElementRef>([
      ['e1', { ref: 'e1', role: 'button', name: 'Go', nodeId: 1 }],
    ]);
    expect(resolveRef({} as CdpClient, 'S1', refs, 'e1')).resolves.toMatchObject({ ref: 'e1' });
  });

  it('throws a snapshot-first hint when the ref is unknown', async () => {
    await expect(resolveRef({} as CdpClient, 'S1', new Map(), 'e9')).rejects.toThrow(
      'Element ref @e9 not found. Run snapshot first.'
    );
  });
});

describe('getObjectIdForRef', () => {
  it('short-circuits to null without a CDP call when there is no backend node id', async () => {
    const send = vi.fn();
    const client = { send } as unknown as CdpClient;
    await expect(
      getObjectIdForRef(client, 'S1', { ref: 'e1', role: 'button', name: '', nodeId: 1 })
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves via DOM.resolveNode on the backend node id', async () => {
    const send = vi.fn(async () => ({ object: { objectId: 'OBJ' } }));
    const client = { send } as unknown as CdpClient;
    await expect(
      getObjectIdForRef(client, 'S1', { ref: 'e1', role: 'button', name: '', nodeId: 1, backendDOMNodeId: 77 })
    ).resolves.toBe('OBJ');
    expect(send.mock.calls[0]).toEqual(['DOM.resolveNode', { backendNodeId: 77 }, 'S1']);
  });

  it('returns null when the node no longer resolves to an object', async () => {
    const client = { send: vi.fn(async () => ({ object: {} })) } as unknown as CdpClient;
    await expect(
      getObjectIdForRef(client, 'S1', { ref: 'e1', role: 'button', name: '', nodeId: 1, backendDOMNodeId: 77 })
    ).resolves.toBeNull();
  });
});

describe('getElementBox', () => {
  it('reports the CENTER of the content quad, per the documented contract', async () => {
    const client = {
      send: vi.fn(async () => ({
        model: { content: [10, 20, 110, 20, 110, 60, 10, 60], width: 100, height: 40 },
      })),
    } as unknown as CdpClient;
    await expect(
      getElementBox(client, 'S1', { ref: 'e1', role: 'button', name: '', nodeId: 1, backendDOMNodeId: 5 })
    ).resolves.toEqual({ x: 60, y: 40, width: 100, height: 40 });
  });
});
