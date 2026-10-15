/**
 * `agent exec --attach` (rev 31): media type sniffing and the Claude API's
 * 8000 px image limit — the pixel size read from PNG, JPEG, GIF and WebP
 * headers; an image too large, or whose size cannot be read, is listed by
 * path instead of sent as a block. Fixtures are generated here.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { claudeContent, imageSize, sniffMediaType } from '../orgrt/agent-exec-attach.js';

/** A real (decodable) grayscale PNG of the given size, all black. */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type), body])));
    return Buffer.concat([len, Buffer.from(type), body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth; color type 0 (gray), no interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc((width + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A JPEG header: SOI, APP0, DHT (C4 — not a frame), SOFn, SOS, EOI. */
function makeJpeg(width: number, height: number, sof = 0xc0): Buffer {
  const seg = (marker: number, body: number[]) => [
    0xff,
    marker,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
    ...body,
  ];
  return Buffer.from([
    0xff,
    0xd8,
    ...seg(0xe0, [...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...seg(0xc4, Array(17).fill(0)),
    ...seg(sof, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 1, 1, 0x11, 0]),
    ...seg(0xda, [1, 1, 0, 0, 0x3f, 0]),
    0xff,
    0xd9,
  ]);
}

const PNG = makePng(2, 2);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const GIF = Buffer.from('GIF89a\x01\x00', 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([8, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);
const PDF = Buffer.from('%PDF-1.7\n%fake\n');

const dir = mkdtempSync(join(tmpdir(), 'mm-attach-image-'));
function file(name: string, data: Buffer | string): string {
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}

describe('media type sniffing', () => {
  it('reads the first bytes, never the extension', () => {
    expect(sniffMediaType(PNG)).toBe('image/png');
    expect(sniffMediaType(JPEG)).toBe('image/jpeg');
    expect(sniffMediaType(GIF)).toBe('image/gif');
    expect(sniffMediaType(WEBP)).toBe('image/webp');
    expect(sniffMediaType(PDF)).toBe('application/pdf');
    expect(sniffMediaType(Buffer.from('just text'))).toBeUndefined();
    expect(sniffMediaType(Buffer.alloc(0))).toBeUndefined();
  });
});

describe('claude: the 8000 px image limit', () => {
  const types = (paths: string[]) => claudeContent('p', paths).map((b) => b.type);
  const listedText = (paths: string[]) => claudeContent('p', paths).at(-1)?.text;

  it('reads PNG IHDR; a tall PNG generated here is listed, 8000 px is sent', () => {
    const tall = file('tall.png', makePng(1, 9000));
    const edge = file('edge.png', makePng(1, 8000));
    expect(imageSize(makePng(1, 9000))).toEqual({ width: 1, height: 9000 });
    expect(types([tall])).toEqual(['text']);
    expect(listedText([tall])).toBe(`p\n\nAttached files:\n- ${tall}`);
    expect(types([edge])).toEqual(['image', 'text']);
  });

  it('walks JPEG markers past DHT to the SOFn frame (baseline and progressive)', () => {
    expect(imageSize(makeJpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(imageSize(makeJpeg(1200, 9001, 0xc2))).toEqual({ width: 1200, height: 9001 });
    const wide = file('wide.jpg', makeJpeg(8001, 10));
    const ok = file('ok.jpg', makeJpeg(8000, 10));
    expect(types([wide, ok])).toEqual(['image', 'text']);
    expect(listedText([wide, ok])).toBe(`p\n\nAttached files:\n- ${wide}`);
  });

  it('reads GIF and WebP (VP8X, VP8, VP8L) headers', () => {
    const gif = Buffer.from('GIF89a\x10\x27\x02\x00', 'latin1');
    expect(imageSize(gif)).toEqual({ width: 10000, height: 2 });
    const webp = (chunk: string, body: number[]) =>
      Buffer.concat([
        Buffer.from('RIFF\0\0\0\0WEBP'),
        Buffer.from(chunk),
        Buffer.from([body.length, 0, 0, 0, ...body]),
      ]);
    // VP8X: flags + reserved, then width-1 and height-1 as 24-bit LE.
    const vp8x = webp('VP8X', [0, 0, 0, 0, 0x3f, 0x1f, 0, 0x1f, 0, 0]);
    expect(imageSize(vp8x)).toEqual({ width: 8000, height: 32 });
    // VP8: frame tag, start code 9d 01 2a, 14-bit width and height.
    const vp8 = webp('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 0x40, 0x1f, 0x41, 0x1f]);
    expect(imageSize(vp8)).toEqual({ width: 8000, height: 8001 });
    // VP8L: signature 0x2f, then width-1 and height-1 packed in 14 bits each.
    const bits = 99 | (199 << 14);
    const vp8l = webp('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, 0]);
    expect(imageSize(vp8l)).toEqual({ width: 100, height: 200 });
  });

  it('lists an image whose size cannot be read', () => {
    const noIhdr = file(
      'no-ihdr.png',
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const noFrame = file('no-frame.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 2, 0xff, 0xd9]));
    const bareWebp = file('bare.webp', WEBP);
    expect(imageSize(readFileSync(noIhdr))).toBeUndefined();
    expect(imageSize(readFileSync(noFrame))).toBeUndefined();
    expect(types([noIhdr, noFrame, bareWebp])).toEqual(['text']);
    expect(listedText([noIhdr, noFrame, bareWebp])).toBe(
      `p\n\nAttached files:\n- ${noIhdr}\n- ${noFrame}\n- ${bareWebp}`,
    );
  });
});
