import { describe, it, expect, vi } from 'vitest';
import { deriveBoxOutput } from '../cli/commands.js';
import { getElementBox } from '../browser/snapshot.js';
import type { ElementRef } from '../browser/types.js';

describe('getElementBox (issue #15: center-vs-top-left contract)', () => {
  it('averages the CDP content quad\'s four corners into a center point', async () => {
    // Content quad order per CDP DOM.getBoxModel: [x1,y1 top-left, x2,y2
    // top-right, x3,y3 bottom-right, x4,y4 bottom-left]. A 372x37 box whose
    // top-left is (454, 513.5) — matching the issue's own reproduction data.
    const client = {
      send: vi.fn().mockResolvedValue({
        model: {
          content: [454, 513.5, 826, 513.5, 826, 550.5, 454, 550.5],
          width: 372,
          height: 37,
        },
      }),
    };
    const ref = { backendDOMNodeId: 1 } as unknown as ElementRef;
    const box = await getElementBox(client as any, 'session-1', ref);
    expect(box).toEqual({ x: 640, y: 532, width: 372, height: 37 });
  });
});

describe('deriveBoxOutput (issue #15: get box exposing both conventions)', () => {
  it('derives true top-left x/y from the center point, alongside explicit centerX/centerY', () => {
    const center = { x: 640, y: 532, width: 372, height: 37 };
    const result = deriveBoxOutput(center);
    expect(result).toEqual({
      x: 454, y: 513.5, width: 372, height: 37,
      centerX: 640, centerY: 532,
    });
  });

  it('returns null when there is no box (element not in DOM)', () => {
    expect(deriveBoxOutput(null)).toBeNull();
  });
});
