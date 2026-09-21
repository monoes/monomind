/**
 * The PNG codec underpins the pixel diff, so it is tested against images it
 * did not produce as well as its own round trip — an encoder and decoder that
 * are wrong in the same direction would agree with each other perfectly.
 *
 * `assets/mascot.png` and `assets/logo.png` are ordinary 8-bit RGBA PNGs
 * checked into this repo by other tooling; decoding them exercises the real
 * filter mix (Sub/Up/Average/Paeth) that a synthetic image never produces.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, decodePng, encodePng, pngFromDataUrl, pngToDataUrl } from '../report/png.js';

const ASSETS = join(import.meta.dirname, '..', '..', '..', '..', '..', 'assets');

function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, data };
}

describe('crc32', () => {
  it('matches the known CRC-32 of "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('decodePng', () => {
  it('decodes a real 8-bit RGBA PNG at its stated dimensions', () => {
    const img = decodePng(readFileSync(join(ASSETS, 'mascot.png')));
    expect({ width: img.width, height: img.height }).toEqual({ width: 650, height: 618 });
    expect(img.data.length).toBe(650 * 618 * 4);
  });

  it('decodes a second real PNG, exercising a different filter mix', () => {
    const img = decodePng(readFileSync(join(ASSETS, 'logo.png')));
    expect(img.data.length).toBe(img.width * img.height * 4);
    // A logo is not uniform: if unfiltering were broken every row would be
    // identical or the image would be a single flat colour.
    const unique = new Set<string>();
    for (let i = 0; i < img.data.length; i += 4) {
      unique.add(`${img.data[i]},${img.data[i + 1]},${img.data[i + 2]},${img.data[i + 3]}`);
      if (unique.size > 5) break;
    }
    expect(unique.size).toBeGreaterThan(5);
  });

  it('rejects a file that is not a PNG', () => {
    expect(() => decodePng(new TextEncoder().encode('GIF89a not a png'))).toThrow(/bad signature/);
  });

  it('rejects an interlaced PNG by name rather than decoding it wrongly', () => {
    const png = encodePng(solid(2, 2, [1, 2, 3, 4]));
    png[8 + 8 + 12] = 1; // IHDR interlace byte
    expect(() => decodePng(png)).toThrow(/interlaced/);
  });
});

describe('encodePng', () => {
  it('round-trips an image byte-for-byte', () => {
    const img = decodePng(readFileSync(join(ASSETS, 'mascot.png')));
    const again = decodePng(encodePng(img));
    expect(again.width).toBe(img.width);
    expect(again.height).toBe(img.height);
    expect(Buffer.from(again.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('writes the PNG signature and an IEND chunk', () => {
    const png = encodePng(solid(3, 2, [10, 20, 30, 255]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('refuses a pixel buffer whose length disagrees with the dimensions', () => {
    expect(() => encodePng({ width: 4, height: 4, data: new Uint8Array(8) })).toThrow(
      /expected 64 bytes/,
    );
  });
});

describe('data URLs', () => {
  it('round-trips through a data: URL', () => {
    const png = encodePng(solid(2, 2, [7, 8, 9, 255]));
    const url = pngToDataUrl(png);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(pngFromDataUrl(url)).equals(png)).toBe(true);
  });

  it('accepts a bare base64 payload, which is what CDP actually returns', () => {
    const png = encodePng(solid(1, 1, [1, 1, 1, 255]));
    const bare = Buffer.from(png).toString('base64');
    expect(Buffer.from(pngFromDataUrl(bare)).equals(png)).toBe(true);
  });
});
