/**
 * A minimal PNG decoder and encoder built on node's own `zlib`.
 *
 * This exists so the pixel diff (RIG-10) can compare two screenshots without
 * adding an image dependency to a package whose whole point is to be a small
 * self-contained CDP client. PNG is simple enough to justify it: the format
 * is a chunk list wrapping one zlib stream, and node ships the zlib.
 *
 * Scope is deliberately narrow — what `Page.captureScreenshot` actually
 * emits. Non-interlaced, bit depth 8 (16 is accepted by taking the high
 * byte), colour types 0/2/3/4/6. Anything else throws a message that names
 * what it saw, so the caller can degrade to "pixel diff unavailable" instead
 * of rendering a wrong picture.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface RgbaImage {
  width: number;
  height: number;
  /** Row-major RGBA, 4 bytes per pixel, length === width * height * 4. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// CRC32 — PNG chunks carry their own checksum, and zlib does not expose one.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Undo the per-scanline filters in place, returning the raw sample bytes. */
function unfilter(raw: Buffer, width: number, height: number, bpp: number, stride: number): Buffer {
  const out = Buffer.alloc(height * stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const line = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      const v = line[x];
      switch (filter) {
        case 0:
          cur[x] = v;
          break;
        case 1:
          cur[x] = (v + a) & 0xff;
          break;
        case 2:
          cur[x] = (v + b) & 0xff;
          break;
        case 3:
          cur[x] = (v + ((a + b) >> 1)) & 0xff;
          break;
        case 4:
          cur[x] = (v + paeth(a, b, c)) & 0xff;
          break;
        default:
          throw new Error(`PNG: unknown scanline filter ${filter} on row ${y}`);
      }
    }
  }
  void width;
  return out;
}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

function readHeader(buf: Buffer, offset: number): Header {
  return {
    width: buf.readUInt32BE(offset),
    height: buf.readUInt32BE(offset + 4),
    bitDepth: buf[offset + 8],
    colorType: buf[offset + 9],
    interlace: buf[offset + 12],
  };
}

/**
 * Expand one row of decoded samples into RGBA. `step` is the byte stride of
 * one sample (1 for bit depth 8, 2 for 16 — where we keep the high byte).
 */
function toRgba(
  samples: Buffer,
  header: Header,
  palette: Buffer | null,
  transparency: Buffer | null,
): Uint8Array {
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType];
  const step = bitDepth === 16 ? 2 : 1;
  const stride = width * channels * step;
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * stride + x * channels * step;
      const d = (y * width + x) * 4;
      if (colorType === 3) {
        const index = samples[s];
        if (!palette || index * 3 + 2 >= palette.length) {
          throw new Error(`PNG: palette index ${index} out of range`);
        }
        out[d] = palette[index * 3];
        out[d + 1] = palette[index * 3 + 1];
        out[d + 2] = palette[index * 3 + 2];
        out[d + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else if (colorType === 0) {
        const g = samples[s];
        out[d] = g;
        out[d + 1] = g;
        out[d + 2] = g;
        out[d + 3] = 255;
      } else if (colorType === 4) {
        const g = samples[s];
        out[d] = g;
        out[d + 1] = g;
        out[d + 2] = g;
        out[d + 3] = samples[s + step];
      } else if (colorType === 2) {
        out[d] = samples[s];
        out[d + 1] = samples[s + step];
        out[d + 2] = samples[s + 2 * step];
        out[d + 3] = 255;
      } else {
        out[d] = samples[s];
        out[d + 1] = samples[s + step];
        out[d + 2] = samples[s + 2 * step];
        out[d + 3] = samples[s + 3 * step];
      }
    }
  }
  return out;
}

export function decodePng(input: Uint8Array): RgbaImage {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('PNG: not a PNG (bad signature)');
  }

  let header: Header | null = null;
  let palette: Buffer | null = null;
  let transparency: Buffer | null = null;
  const idat: Buffer[] = [];

  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const dataStart = pos + 8;
    if (dataStart + length > buf.length) throw new Error(`PNG: truncated ${type} chunk`);
    if (type === 'IHDR') header = readHeader(buf, dataStart);
    else if (type === 'PLTE') palette = buf.subarray(dataStart, dataStart + length);
    else if (type === 'tRNS') transparency = buf.subarray(dataStart, dataStart + length);
    else if (type === 'IDAT') idat.push(buf.subarray(dataStart, dataStart + length));
    else if (type === 'IEND') break;
    pos = dataStart + length + 4;
  }

  if (!header) throw new Error('PNG: no IHDR chunk');
  if (header.interlace !== 0) {
    throw new Error('PNG: interlaced (Adam7) images are not supported');
  }
  if (header.bitDepth !== 8 && header.bitDepth !== 16) {
    throw new Error(`PNG: unsupported bit depth ${header.bitDepth} (need 8 or 16)`);
  }
  const channels = CHANNELS[header.colorType];
  if (channels === undefined) {
    throw new Error(`PNG: unsupported colour type ${header.colorType}`);
  }
  if (header.colorType === 3 && header.bitDepth !== 8) {
    throw new Error(`PNG: palette images below bit depth 8 are not supported`);
  }
  if (!idat.length) throw new Error('PNG: no IDAT data');

  const sampleBytes = header.bitDepth === 16 ? 2 : 1;
  const stride = header.width * channels * sampleBytes;
  const bpp = Math.max(1, channels * sampleBytes);
  const inflated = inflateSync(Buffer.concat(idat));
  const expected = header.height * (stride + 1);
  if (inflated.length < expected) {
    throw new Error(`PNG: pixel data short by ${expected - inflated.length} bytes`);
  }
  const samples = unfilter(inflated, header.width, header.height, bpp, stride);

  return {
    width: header.width,
    height: header.height,
    data: toRgba(samples, header, palette, transparency),
  };
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, crc]);
}

/** Encode RGBA bytes as a non-interlaced, 8-bit truecolour-with-alpha PNG. */
export function encodePng(image: RgbaImage): Buffer {
  const { width, height, data } = image;
  if (data.length !== width * height * 4) {
    throw new Error(
      `PNG: encode expected ${width * height * 4} bytes for ${width}x${height}, got ${data.length}`,
    );
  }
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None. Simplest, and deflate still wins.
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** `data:image/png;base64,...` -> bytes. Accepts a bare base64 payload too. */
export function pngFromDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const payload = dataUrl.startsWith('data:') && comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return new Uint8Array(Buffer.from(payload, 'base64'));
}

export function pngToDataUrl(png: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}
