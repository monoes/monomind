/**
 * RIG-10 — the two halves of the run-to-run diff.
 *
 * The structural half is fed hand-written AX trees; the pixel half is fed
 * PNGs this test encodes itself, so both run without Chrome.
 */
import { describe, expect, it } from 'vitest';
import { pixelDiff, summarizePixelDiff } from '../report/pixel-diff.js';
import { encodePng, type RgbaImage } from '../report/png.js';
import { buildStructure, diffStructure, summarizeStructureDiff } from '../report/structure.js';
import type { AxNode, StructureNode } from '../report/types.js';

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

const node = (
  id: number,
  role: string,
  name: string | null,
  childIds: number[] = [],
  extra: Partial<AxNode> = {},
): AxNode => ({
  nodeId: id,
  role: { value: role },
  ...(name === null ? {} : { name: { value: name } }),
  childIds,
  ...extra,
});

/** A small page: a form with a labelled field and two buttons. */
function page(overrides: { submitName?: string; extraButton?: boolean } = {}): AxNode[] {
  const formChildren = [3, 4];
  if (overrides.extraButton) formChildren.push(5);
  return [
    node(1, 'RootWebArea', 'Checkout', [2]),
    node(2, 'form', 'Payment', formChildren.length ? [3, 4] : []),
    node(3, 'textbox', 'Card number'),
    node(4, 'button', overrides.submitName ?? 'Pay now'),
    ...(overrides.extraButton ? [node(5, 'button', 'Cancel')] : []),
  ].map((n) => (n.nodeId === 2 ? { ...n, childIds: formChildren } : n));
}

describe('buildStructure', () => {
  it('paths each element by role and sibling index', () => {
    const structure = buildStructure(page());
    expect(structure.map((s) => s.path)).toEqual([
      '/rootwebarea[1]',
      '/rootwebarea[1]/form[1]',
      '/rootwebarea[1]/form[1]/textbox[1]',
      '/rootwebarea[1]/form[1]/button[1]',
    ]);
    expect(structure[3]).toMatchObject({ role: 'button', name: 'Pay now', depth: 2 });
  });

  it('splices transparent wrappers away so a styling div cannot shift a path', () => {
    const wrapped = [
      node(1, 'RootWebArea', 'Checkout', [9]),
      node(9, 'generic', null, [2]),
      node(2, 'button', 'Pay now'),
    ];
    expect(buildStructure(wrapped).map((s) => s.path)).toEqual([
      '/rootwebarea[1]',
      '/rootwebarea[1]/button[1]',
    ]);
  });

  it('skips ignored nodes but keeps their children', () => {
    const tree = [
      node(1, 'RootWebArea', 'Page', [2]),
      node(2, 'section', 'Hidden wrapper', [3], { ignored: true }),
      node(3, 'link', 'Continue'),
    ];
    expect(buildStructure(tree).map((s) => s.role)).toEqual(['rootwebarea', 'link']);
  });

  it('collapses whitespace in accessible names so reflow is not a rename', () => {
    const tree = [node(1, 'button', '  Pay   \n  now ')];
    expect(buildStructure(tree)[0].name).toBe('Pay now');
  });

  it('survives a cyclic tree instead of looping forever', () => {
    const cyclic = [node(1, 'RootWebArea', 'Loop', [2]), node(2, 'group', 'Child', [1])];
    const structure = buildStructure(cyclic);
    expect(structure.length).toBe(2);
  });

  it('caps a pathological tree rather than emitting a row per node', () => {
    const many: AxNode[] = [node(1, 'RootWebArea', 'Big', [])];
    const childIds: number[] = [];
    for (let i = 2; i < 3000; i++) {
      childIds.push(i);
      many.push(node(i, 'listitem', `Item ${i}`));
    }
    many[0] = node(1, 'RootWebArea', 'Big', childIds);
    expect(buildStructure(many).length).toBeLessThanOrEqual(1500);
  });
});

describe('diffStructure', () => {
  it('reports an identical page as unchanged', () => {
    const before = buildStructure(page());
    const after = buildStructure(page());
    const diff = diffStructure(before, after);
    expect(diff).toMatchObject({ changed: 0, gained: [], lost: [], renamed: [] });
    expect(diff.unchanged).toBe(4);
    expect(summarizeStructureDiff(diff)).toBe('structurally identical');
  });

  it('reports a changed accessible name as a rename, not an add and a delete', () => {
    const diff = diffStructure(
      buildStructure(page()),
      buildStructure(page({ submitName: 'Place order' })),
    );
    expect(diff.gained).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.renamed).toEqual([
      {
        path: '/rootwebarea[1]/form[1]/button[1]',
        role: 'button',
        from: 'Pay now',
        to: 'Place order',
      },
    ]);
    expect(summarizeStructureDiff(diff)).toBe('1 renamed');
  });

  it('reports a new element as gained', () => {
    const diff = diffStructure(buildStructure(page()), buildStructure(page({ extraButton: true })));
    expect(diff.gained.map((n) => n.name)).toEqual(['Cancel']);
    expect(diff.lost).toEqual([]);
  });

  it('reports a removed element as lost', () => {
    const diff = diffStructure(buildStructure(page({ extraButton: true })), buildStructure(page()));
    expect(diff.lost.map((n) => n.name)).toEqual(['Cancel']);
    expect(diff.gained).toEqual([]);
  });

  it('calls a reordered element moved, not gained-and-lost', () => {
    // Inserting at the front renumbers every later sibling; a path-only diff
    // would call that four changes.
    const before: StructureNode[] = [
      { path: '/list[1]/listitem[1]', role: 'listitem', name: 'Alpha', depth: 1 },
      { path: '/list[1]/listitem[2]', role: 'listitem', name: 'Beta', depth: 1 },
    ];
    const after: StructureNode[] = [
      { path: '/list[1]/listitem[1]', role: 'listitem', name: 'Beta', depth: 1 },
      { path: '/list[1]/listitem[2]', role: 'listitem', name: 'Alpha', depth: 1 },
    ];
    const diff = diffStructure(before, after);
    expect(diff.gained).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.renamed.length).toBe(2);
  });

  it('recovers an element that moved to a different parent', () => {
    const before: StructureNode[] = [
      { path: '/main[1]/button[1]', role: 'button', name: 'Help', depth: 1 },
    ];
    const after: StructureNode[] = [
      { path: '/footer[1]/button[1]', role: 'button', name: 'Help', depth: 1 },
    ];
    const diff = diffStructure(before, after);
    expect(diff.gained).toEqual([]);
    expect(diff.lost).toEqual([]);
    expect(diff.moved).toEqual([
      { role: 'button', name: 'Help', from: '/main[1]/button[1]', to: '/footer[1]/button[1]' },
    ]);
    expect(diff.changed).toBe(0);
  });

  it('treats a role change in the same slot as a replacement', () => {
    const before: StructureNode[] = [{ path: '/x[1]', role: 'button', name: 'Go', depth: 0 }];
    const after: StructureNode[] = [{ path: '/x[1]', role: 'link', name: 'Go', depth: 0 }];
    const diff = diffStructure(before, after);
    expect(diff.renamed).toEqual([]);
    expect(diff.gained.map((n) => n.role)).toEqual(['link']);
    expect(diff.lost.map((n) => n.role)).toEqual(['button']);
  });
});

// ---------------------------------------------------------------------------
// Pixels
// ---------------------------------------------------------------------------

function canvas(width: number, height: number, fill: [number, number, number]): RgbaImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...fill, 255], i * 4);
  return { width, height, data };
}

function withBlock(
  base: RgbaImage,
  x0: number,
  y0: number,
  w: number,
  h: number,
  fill: [number, number, number],
): RgbaImage {
  const data = new Uint8Array(base.data);
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      data.set([...fill, 255], (y * base.width + x) * 4);
    }
  }
  return { ...base, data };
}

describe('pixelDiff', () => {
  const base = canvas(40, 40, [255, 255, 255]);

  it('reports zero change for identical screenshots and renders no image', () => {
    const png = encodePng(base);
    const diff = pixelDiff(png, png);
    expect(diff).toMatchObject({ comparable: true, changedPixels: 0, changedPercent: 0 });
    expect(diff.diffDataUrl).toBeUndefined();
    expect(summarizePixelDiff(diff)).toBe('0% of pixels changed');
  });

  it('counts exactly the pixels that changed', () => {
    const changed = withBlock(base, 5, 5, 10, 10, [0, 0, 0]);
    const diff = pixelDiff(encodePng(base), encodePng(changed));
    expect(diff.changedPixels).toBe(100);
    expect(diff.totalPixels).toBe(1600);
    expect(diff.changedPercent).toBeCloseTo(6.25, 5);
    expect(diff.diffDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('ignores sub-threshold noise, which is what rasteriser jitter looks like', () => {
    const jittered = withBlock(base, 0, 0, 40, 40, [250, 250, 250]);
    expect(pixelDiff(encodePng(base), encodePng(jittered)).changedPixels).toBe(0);
    // ...but the same pixels at a real difference are counted.
    const real = withBlock(base, 0, 0, 40, 40, [200, 200, 200]);
    expect(pixelDiff(encodePng(base), encodePng(real)).changedPixels).toBe(1600);
  });

  it('handles a page that grew taller, counting the new region as changed', () => {
    const taller = canvas(40, 60, [255, 255, 255]);
    const diff = pixelDiff(encodePng(base), encodePng(taller));
    expect(diff.sizeChanged).toBe(true);
    expect(diff.previousSize).toEqual({ width: 40, height: 40 });
    expect(diff.currentSize).toEqual({ width: 40, height: 60 });
    // The 800 new pixels, measured against the larger of the two areas.
    expect(diff.changedPixels).toBe(800);
    expect(diff.totalPixels).toBe(2400);
    expect(summarizePixelDiff(diff)).toContain('size 40x40 -> 40x60');
  });

  it('counts pixels the previous shot had and this one does not', () => {
    const shorter = canvas(40, 20, [255, 255, 255]);
    const diff = pixelDiff(encodePng(base), encodePng(shorter));
    expect(diff.changedPixels).toBe(800);
    expect(diff.totalPixels).toBe(1600);
  });

  it('downscales the highlight image instead of inlining a giant PNG', () => {
    const big = canvas(1600, 1200, [255, 255, 255]);
    const diff = pixelDiff(encodePng(big), encodePng(withBlock(big, 0, 0, 40, 40, [0, 0, 0])), {
      maxPixels: 40_000,
    });
    expect(diff.scale).toBeGreaterThan(1);
    expect(diff.changedPixels).toBe(1600);
  });

  it('degrades to a note rather than throwing when a screenshot will not decode', () => {
    const diff = pixelDiff(new TextEncoder().encode('not a png'), encodePng(base));
    expect(diff.comparable).toBe(false);
    expect(diff.note).toMatch(/Pixel diff skipped/);
    expect(summarizePixelDiff(diff)).toMatch(/Pixel diff skipped/);
  });
});
