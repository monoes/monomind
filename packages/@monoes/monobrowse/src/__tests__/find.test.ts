/**
 * find.ts — locator semantics over the snapshot ref map.
 *
 * findByRole / findByText / findByLabel / findByPlaceholder never talk to the
 * browser at all: they filter the in-memory ref Map. findBySelector and
 * findByTestId do issue CDP commands, which a recording stub answers.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CdpClient } from '../browser/cdp.js';
import type { ElementRef } from '../browser/types.js';
import {
  findBySelector,
  findByRole,
  findByText,
  findByLabel,
  findByPlaceholder,
  findByTestId,
  isEnabled,
  isVisible,
  isChecked,
  scrollIntoView,
} from '../browser/find.js';

function ref(partial: Partial<ElementRef> & { ref: string }): ElementRef {
  return { role: 'generic', name: '', nodeId: 1, ...partial };
}

/** Ref map mirroring a small page snapshot. */
function sampleRefs(): Map<string, ElementRef> {
  const entries: ElementRef[] = [
    ref({ ref: 'e1', role: 'button', name: 'Save changes', backendDOMNodeId: 11 }),
    ref({ ref: 'e2', role: 'BUTTON', name: 'Save', backendDOMNodeId: 12 }),
    ref({ ref: 'e3', role: 'link', name: 'Save as draft', backendDOMNodeId: 13 }),
    ref({ ref: 'e4', role: 'textbox', name: 'Email', placeholder: 'you@example.com', backendDOMNodeId: 14 }),
    ref({ ref: 'e5', role: 'textbox', name: 'Notes', placeholder: 'Optional notes', backendDOMNodeId: 15, disabled: true }),
  ];
  return new Map(entries.map((e) => [e.ref, e]));
}

/** Answers a per-method table and records every call. */
function stubClient(table: Record<string, unknown> = {}): {
  client: CdpClient;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const client = {
    send: vi.fn(async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      const entry = table[method];
      if (typeof entry === 'function') return (entry as (p: unknown) => unknown)(params);
      if (entry instanceof Error) throw entry;
      return entry ?? {};
    }),
  } as unknown as CdpClient;
  return { client, calls };
}

describe('nth validation is shared by every locator', () => {
  const { client } = stubClient();
  const refs = sampleRefs();

  it.each([
    ['findBySelector', () => findBySelector(client, 'S1', refs, 'button', { nth: 0 })],
    ['findByRole', () => findByRole(client, 'S1', refs, 'button', { nth: 0 })],
    ['findByText', () => findByText(client, 'S1', refs, 'Save', { nth: 0 })],
    ['findByPlaceholder', () => findByPlaceholder(client, 'S1', refs, 'you', { nth: -1 })],
  ])('%s rejects nth below 1', async (_label, run) => {
    await expect(run()).rejects.toThrow(/nth must be >= 1 \(received (0|-1)\)/);
  });
});

describe('findByRole', () => {
  it('matches the role case-insensitively', async () => {
    const { client } = stubClient();
    const found = await findByRole(client, 'S1', sampleRefs(), 'BUTTON');
    expect(found?.ref).toBe('e1');
  });

  it('does substring name matching by default', async () => {
    const { client } = stubClient();
    const found = await findByRole(client, 'S1', sampleRefs(), 'button', { name: 'save cha' });
    expect(found?.ref).toBe('e1');
  });

  it('requires a full name match under exact', async () => {
    const { client } = stubClient();
    expect((await findByRole(client, 'S1', sampleRefs(), 'button', { name: 'Save', exact: true }))?.ref).toBe('e2');
    expect(await findByRole(client, 'S1', sampleRefs(), 'button', { name: 'Sav', exact: true })).toBeNull();
  });

  it('nth is 1-based over the filtered matches', async () => {
    const { client } = stubClient();
    const refs = sampleRefs();
    expect((await findByRole(client, 'S1', refs, 'button', { nth: 1 }))?.ref).toBe('e1');
    expect((await findByRole(client, 'S1', refs, 'button', { nth: 2 }))?.ref).toBe('e2');
    expect(await findByRole(client, 'S1', refs, 'button', { nth: 3 })).toBeNull();
  });

  it('last returns the final match', async () => {
    const { client } = stubClient();
    expect((await findByRole(client, 'S1', sampleRefs(), 'button', { last: true }))?.ref).toBe('e2');
  });

  it('returns null when no ref carries that role', async () => {
    const { client } = stubClient();
    expect(await findByRole(client, 'S1', sampleRefs(), 'checkbox')).toBeNull();
  });

  it('issues no CDP command at all', async () => {
    const { client, calls } = stubClient();
    await findByRole(client, 'S1', sampleRefs(), 'button');
    expect(calls).toEqual([]);
  });
});

describe('findByText', () => {
  it('matches names case-insensitively as a substring', async () => {
    const { client } = stubClient();
    expect((await findByText(client, 'S1', sampleRefs(), 'save as'))?.ref).toBe('e3');
  });

  it('spans roles — first match wins', async () => {
    const { client } = stubClient();
    expect((await findByText(client, 'S1', sampleRefs(), 'save'))?.ref).toBe('e1');
  });

  it('honours exact, nth and last', async () => {
    const { client } = stubClient();
    const refs = sampleRefs();
    expect((await findByText(client, 'S1', refs, 'Save', { exact: true }))?.ref).toBe('e2');
    expect((await findByText(client, 'S1', refs, 'save', { nth: 2 }))?.ref).toBe('e2');
    expect((await findByText(client, 'S1', refs, 'save', { last: true }))?.ref).toBe('e3');
    expect(await findByText(client, 'S1', refs, 'save', { nth: 9 })).toBeNull();
  });

  it('returns null on no match', async () => {
    const { client } = stubClient();
    expect(await findByText(client, 'S1', sampleRefs(), 'nonexistent')).toBeNull();
  });

  it('findByLabel delegates to the same matching', async () => {
    const { client } = stubClient();
    const refs = sampleRefs();
    expect(await findByLabel(client, 'S1', refs, 'Email')).toBe(await findByText(client, 'S1', refs, 'Email'));
  });
});

describe('findByPlaceholder', () => {
  it('matches on the placeholder attribute, not the accessible name', async () => {
    const { client } = stubClient();
    expect((await findByPlaceholder(client, 'S1', sampleRefs(), 'example.com'))?.ref).toBe('e4');
  });

  it('treats a missing placeholder as empty rather than crashing', async () => {
    const { client } = stubClient();
    // e1..e3 have no placeholder; an empty needle must not match them under exact.
    expect((await findByPlaceholder(client, 'S1', sampleRefs(), '', { exact: true }))?.ref).toBe('e1');
    expect(await findByPlaceholder(client, 'S1', sampleRefs(), 'nope')).toBeNull();
  });

  it('honours exact, nth and last', async () => {
    const { client } = stubClient();
    const refs = sampleRefs();
    expect((await findByPlaceholder(client, 'S1', refs, 'Optional notes', { exact: true }))?.ref).toBe('e5');
    expect((await findByPlaceholder(client, 'S1', refs, 'o', { nth: 1 }))?.ref).toBe('e4');
    expect((await findByPlaceholder(client, 'S1', refs, 'o', { last: true }))?.ref).toBe('e5');
  });
});

describe('findBySelector', () => {
  const doc = { root: { nodeId: 1 } };

  it('reuses an existing snapshot ref when the backend node already maps to one', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelector': { nodeId: 55 },
      'DOM.describeNode': { node: { backendNodeId: 11 } },
    });
    const refs = sampleRefs();
    const found = await findBySelector(client, 'S1', refs, 'button.save');
    expect(found?.ref).toBe('e1');
    expect(refs.size).toBe(5);
  });

  it('mints a synthetic ref for an element absent from the AX tree and registers it', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelector': { nodeId: 55 },
      'DOM.describeNode': { node: { backendNodeId: 999 } },
    });
    const refs = sampleRefs();
    const found = await findBySelector(client, 'S1', refs, 'div.hidden');
    expect(found).toMatchObject({ ref: 'sel-999', role: 'generic', name: 'div.hidden', nodeId: 55 });
    expect(refs.get('sel-999')).toBe(found);
  });

  it('returns null when the selector matches nothing', async () => {
    const { client } = stubClient({ 'DOM.getDocument': doc, 'DOM.querySelector': { nodeId: 0 } });
    expect(await findBySelector(client, 'S1', sampleRefs(), '.missing')).toBeNull();
  });

  it('returns null when describeNode yields no backend id', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelector': { nodeId: 55 },
      'DOM.describeNode': { node: {} },
    });
    expect(await findBySelector(client, 'S1', sampleRefs(), 'div')).toBeNull();
  });

  it('switches to querySelectorAll for nth and picks the 1-based entry', async () => {
    const { client, calls } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelectorAll': { nodeIds: [10, 20, 30] },
      'DOM.describeNode': { node: { backendNodeId: 999 } },
    });
    await findBySelector(client, 'S1', sampleRefs(), 'li', { nth: 2 });
    expect(calls.map((c) => c.method)).toContain('DOM.querySelectorAll');
    expect(calls.find((c) => c.method === 'DOM.describeNode')!.params).toEqual({ nodeId: 20 });
  });

  it('last picks the final nodeId', async () => {
    const { client, calls } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelectorAll': { nodeIds: [10, 20, 30] },
      'DOM.describeNode': { node: { backendNodeId: 999 } },
    });
    await findBySelector(client, 'S1', sampleRefs(), 'li', { last: true });
    expect(calls.find((c) => c.method === 'DOM.describeNode')!.params).toEqual({ nodeId: 30 });
  });

  it('returns null when querySelectorAll finds nothing', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelectorAll': { nodeIds: [] },
    });
    expect(await findBySelector(client, 'S1', sampleRefs(), 'li', { nth: 1 })).toBeNull();
  });

  it('rethrows a malformed-selector error instead of masking it as "not found"', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelector': new Error("SyntaxError: '((' is not a valid selector"),
    });
    await expect(findBySelector(client, 'S1', sampleRefs(), '((')).rejects.toThrow(/not a valid selector/);
  });

  it('swallows transient CDP errors and reports not-found', async () => {
    const { client } = stubClient({
      'DOM.getDocument': doc,
      'DOM.querySelector': new Error('Node with given id does not belong to the document'),
    });
    expect(await findBySelector(client, 'S1', sampleRefs(), 'div')).toBeNull();
  });
});

describe('findByTestId', () => {
  it('tries data-testid, then data-test-id, then data-test', async () => {
    const seen: string[] = [];
    const client = {
      send: vi.fn(async (_m: string, params: { expression: string }) => {
        seen.push(params.expression);
        // Only the third form exists on this page.
        return { result: { value: seen.length === 3 } };
      }),
    } as unknown as CdpClient;
    await expect(findByTestId(client, 'S1', 'submit')).resolves.toBe('[data-test="submit"]');
    expect(seen).toHaveLength(3);
    expect(seen.map((e) => JSON.parse(e.slice('!!document.querySelector('.length, -1)))).toEqual([
      '[data-testid="submit"]',
      '[data-test-id="submit"]',
      '[data-test="submit"]',
    ]);
  });

  it('returns the first attribute form that matches', async () => {
    const client = {
      send: vi.fn(async () => ({ result: { value: true } })),
    } as unknown as CdpClient;
    await expect(findByTestId(client, 'S1', 'submit')).resolves.toBe('[data-testid="submit"]');
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('returns null when no attribute form matches', async () => {
    const client = { send: vi.fn(async () => ({ result: { value: false } })) } as unknown as CdpClient;
    await expect(findByTestId(client, 'S1', 'nope')).resolves.toBeNull();
  });

  it('escapes quotes and backslashes so the testId cannot break out of the attribute selector', async () => {
    const seen: string[] = [];
    const client = {
      send: vi.fn(async (_m: string, params: { expression: string }) => {
        seen.push(params.expression);
        return { result: { value: false } };
      }),
    } as unknown as CdpClient;
    await findByTestId(client, 'S1', 'a"]:has(script)\\b');
    // The selector is JSON-embedded, so parsing it back must recover an
    // attribute selector whose value is the raw testId with escapes intact.
    const literal = seen[0]!.slice('!!document.querySelector('.length, -1);
    expect(JSON.parse(literal)).toBe('[data-testid="a\\"]:has(script)\\\\b"]');
  });
});

describe('element state helpers', () => {
  it('isEnabled reads the snapshot flag without a round trip', async () => {
    const { client, calls } = stubClient();
    await expect(isEnabled(client, 'S1', ref({ ref: 'e1' }))).resolves.toBe(true);
    await expect(isEnabled(client, 'S1', ref({ ref: 'e5', disabled: true }))).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('isVisible / isChecked report false for a ref with no backend node', async () => {
    const { client, calls } = stubClient();
    const stale = ref({ ref: 'gone' });
    await expect(isVisible(client, 'S1', stale)).resolves.toBe(false);
    await expect(isChecked(client, 'S1', stale)).resolves.toBe(false);
    expect(calls).toEqual([]);
  });

  it('isVisible / isChecked report false when the node no longer resolves', async () => {
    const { client } = stubClient({ 'DOM.resolveNode': { object: {} } });
    const r = ref({ ref: 'e1', backendDOMNodeId: 11 });
    await expect(isVisible(client, 'S1', r)).resolves.toBe(false);
    await expect(isChecked(client, 'S1', r)).resolves.toBe(false);
  });

  it('isVisible returns the page-side boolean via callFunctionOn', async () => {
    const { client, calls } = stubClient({
      'DOM.resolveNode': { object: { objectId: 'OBJ1' } },
      'Runtime.callFunctionOn': { result: { value: true } },
    });
    await expect(isVisible(client, 'S1', ref({ ref: 'e1', backendDOMNodeId: 11 }))).resolves.toBe(true);
    expect(calls.find((c) => c.method === 'Runtime.callFunctionOn')!.params).toMatchObject({
      objectId: 'OBJ1',
      returnByValue: true,
    });
  });

  it('isChecked coerces a missing value to false', async () => {
    const { client } = stubClient({
      'DOM.resolveNode': { object: { objectId: 'OBJ1' } },
      'Runtime.callFunctionOn': { result: {} },
    });
    await expect(isChecked(client, 'S1', ref({ ref: 'e1', backendDOMNodeId: 11 }))).resolves.toBe(false);
  });

  it('scrollIntoView throws a ref-named error when the node is gone', async () => {
    const { client } = stubClient({ 'DOM.resolveNode': { object: {} } });
    await expect(
      scrollIntoView(client, 'S1', ref({ ref: 'e1', backendDOMNodeId: 11 }))
    ).rejects.toThrow('Cannot scroll: ref @e1 not found in DOM');
  });
});
