/**
 * Pixel diff between two screenshots (RIG-10), with no image dependency —
 * png.ts decodes and re-encodes using node's own zlib.
 *
 * Two design choices worth stating:
 *
 *  - A per-channel tolerance, not exact equality. Chrome's rasteriser is not
 *    bit-deterministic across runs (font hinting, GPU vs. software paths), so
 *    an exact compare reports 4% of every screenshot as "changed" and the
 *    number becomes noise nobody reads.
 *  - Differing dimensions are a result, not an error. A page that grew 200px
 *    taller is exactly the regression this is for, so we compare the
 *    overlapping region, count the rest as changed, and say so.
 */

import { decodePng, encodePng, pngToDataUrl, type RgbaImage } from './png.js';
import type { PixelDiff } from './types.js';

/** Per-channel delta below which two pixels are "the same". */
const DEFAULT_THRESHOLD = 16;
/**
 * Cap on the highlight image, in pixels. A full-page shot of a long article
 * can be 1440x20000; inlining that as a data URI would add ~20MB to a report
 * that is supposed to stay openable.
 */
const DEFAULT_MAX_PIXELS = 1_400_000;

export interface PixelDiffOptions {
  threshold?: number;
  maxPixels?: number;
  /** Set false to skip building the highlight image (counts only). */
  renderImage?: boolean;
}

function changedAt(a: Uint8Array, ai: number, b: Uint8Array, bi: number, threshold: number) {
  return (
    Math.abs(a[ai] - b[bi]) > threshold ||
    Math.abs(a[ai + 1] - b[bi + 1]) > threshold ||
    Math.abs(a[ai + 2] - b[bi + 2]) > threshold ||
    Math.abs(a[ai + 3] - b[bi + 3]) > threshold
  );
}

/**
 * Build the highlight image: the current screenshot faded towards white so it
 * reads as context, with changed pixels painted a saturated magenta. Scaled
 * down by an integer factor when the shot is large, ORing the change mask so
 * a one-pixel-wide change survives the downscale instead of being averaged
 * into invisibility.
 */
function renderHighlight(
  current: RgbaImage,
  mask: Uint8Array,
  maxPixels: number,
): { image: RgbaImage; scale: number } {
  const { width, height, data } = current;
  const scale = Math.max(1, Math.ceil(Math.sqrt((width * height) / maxPixels)));
  const outW = Math.max(1, Math.ceil(width / scale));
  const outH = Math.max(1, Math.ceil(height / scale));
  const out = new Uint8Array(outW * outH * 4);

  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      let hit = false;
      for (let dy = 0; dy < scale; dy++) {
        const y = oy * scale + dy;
        if (y >= height) break;
        for (let dx = 0; dx < scale; dx++) {
          const x = ox * scale + dx;
          if (x >= width) break;
          const i = (y * width + x) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
          if (mask[y * width + x]) hit = true;
        }
      }
      const o = (oy * outW + ox) * 4;
      if (!n) {
        out[o + 3] = 255;
        continue;
      }
      if (hit) {
        out[o] = 214;
        out[o + 1] = 31;
        out[o + 2] = 105;
      } else {
        // Fade to white: keeps the layout legible without competing with the
        // magenta, and compresses far better than the original.
        out[o] = Math.round(255 - (255 - r / n) * 0.28);
        out[o + 1] = Math.round(255 - (255 - g / n) * 0.28);
        out[o + 2] = Math.round(255 - (255 - b / n) * 0.28);
      }
      out[o + 3] = 255;
    }
  }
  return { image: { width: outW, height: outH, data: out }, scale };
}

/**
 * Compare two PNGs. Never throws for image-shaped reasons — an undecodable
 * screenshot produces a result carrying `note` and no counts, because a
 * report that renders minus one section beats a report that fails to build.
 */
export function pixelDiff(
  previousPng: Uint8Array,
  currentPng: Uint8Array,
  options: PixelDiffOptions = {},
): PixelDiff {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;

  let prev: RgbaImage;
  let curr: RgbaImage;
  try {
    prev = decodePng(previousPng);
    curr = decodePng(currentPng);
  } catch (err) {
    return {
      comparable: false,
      note: `Pixel diff skipped: ${(err as Error).message}`,
      changedPixels: 0,
      totalPixels: 0,
      changedPercent: 0,
      previousSize: null,
      currentSize: null,
      sizeChanged: false,
    };
  }

  const overlapW = Math.min(prev.width, curr.width);
  const overlapH = Math.min(prev.height, curr.height);
  const sizeChanged = prev.width !== curr.width || prev.height !== curr.height;

  // Denominator is the union, not the overlap: if the page doubled in height,
  // "0.1% of pixels changed" would be a lie told by a small denominator.
  const totalPixels = Math.max(prev.width * prev.height, curr.width * curr.height);
  const mask = new Uint8Array(curr.width * curr.height);
  let changed = 0;

  for (let y = 0; y < curr.height; y++) {
    for (let x = 0; x < curr.width; x++) {
      const ci = (y * curr.width + x) * 4;
      if (x >= overlapW || y >= overlapH) {
        // Outside the overlap there is nothing to compare against: the pixel
        // is new by definition.
        mask[y * curr.width + x] = 1;
        changed++;
        continue;
      }
      const pi = (y * prev.width + x) * 4;
      if (changedAt(prev.data, pi, curr.data, ci, threshold)) {
        mask[y * curr.width + x] = 1;
        changed++;
      }
    }
  }
  // Pixels the previous shot had and this one does not are changes too.
  changed += Math.max(0, prev.width * prev.height - overlapW * overlapH);

  const result: PixelDiff = {
    comparable: true,
    changedPixels: changed,
    totalPixels,
    changedPercent: totalPixels ? (changed / totalPixels) * 100 : 0,
    previousSize: { width: prev.width, height: prev.height },
    currentSize: { width: curr.width, height: curr.height },
    sizeChanged,
  };

  if (options.renderImage !== false && changed > 0) {
    try {
      const { image, scale } = renderHighlight(curr, mask, maxPixels);
      result.diffDataUrl = pngToDataUrl(encodePng(image));
      if (scale > 1) result.scale = scale;
    } catch (err) {
      result.note = `Highlight image not rendered: ${(err as Error).message}`;
    }
  }
  return result;
}

/** One line for a CI log. */
export function summarizePixelDiff(diff: PixelDiff): string {
  if (!diff.comparable) return diff.note ?? 'pixel diff unavailable';
  const pct = diff.changedPercent;
  const shown = pct === 0 ? '0' : pct < 0.01 ? '<0.01' : pct.toFixed(2);
  const size = diff.sizeChanged
    ? ` (size ${diff.previousSize?.width}x${diff.previousSize?.height} -> ${diff.currentSize?.width}x${diff.currentSize?.height})`
    : '';
  return `${shown}% of pixels changed${size}`;
}
