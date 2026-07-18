import { describe, it, expect } from 'vitest';
import { chunkDocument } from './document-chunker.js';

const section = (title: string, paras: number, para: string): string =>
  `## ${title}\n\n${Array.from({ length: paras }, () => para).join('\n\n')}\n`;

describe('chunkDocument', () => {
  it('returns empty for empty input and a single chunk for short docs', () => {
    expect(chunkDocument('d', '')).toEqual([]);
    const one = chunkDocument('d', 'short note');
    expect(one).toHaveLength(1);
    expect(one[0].text).toBe('short note');
  });

  it('breaks before markdown headings so sections start fresh chunks', () => {
    const doc = `# Doc\n\n${section('Pricing', 8, 'p'.repeat(300))}\n${section('Gardening', 8, 'g'.repeat(300))}`;
    const chunks = chunkDocument('d', doc, 2000, 200);
    expect(chunks.length).toBeGreaterThan(1);
    // Some chunk must begin exactly at a section heading (fresh section start)
    expect(chunks.some(c => /^##? /.test(c.text))).toBe(true);
    // No chunk mixes the tail of Pricing with the head of Gardening mid-thought:
    // wherever Gardening appears, it starts at a heading boundary within the chunk
    for (const c of chunks) {
      const idx = c.text.indexOf('## Gardening');
      if (idx > 0) expect(c.text.charAt(idx - 1)).toBe('\n');
    }
  });

  it('prefixes non-heading chunks with their governing section heading', () => {
    const doc = `# Doc\n\n${section('Blueberry Soil', 20, 'acidic soil needs sulfur '.repeat(12))}`;
    const chunks = chunkDocument('d', doc, 1500, 150);
    expect(chunks.length).toBeGreaterThan(1);
    const continuation = chunks.slice(1).find(c => !/^#{1,6} /.test(c.text.trimStart()));
    expect(continuation).toBeDefined();
    expect(continuation!.text.startsWith('§ Blueberry Soil\n')).toBe(true);
  });

  it('start/end offsets always refer to raw source text, never the § prefix', () => {
    const doc = `## Sect\n\n${'x'.repeat(5000)}`;
    const chunks = chunkDocument('d', doc, 1500, 150);
    for (const c of chunks) {
      const raw = doc.slice(c.startChar, c.endChar);
      expect(c.text.endsWith(raw.slice(-50))).toBe(true); // prefix only ever prepends
      expect(c.endChar).toBeGreaterThan(c.startChar);
    }
    // Chunks cover the document end
    expect(chunks[chunks.length - 1].endChar).toBe(doc.length);
  });

  it('keeps prose overlap between chunks that did not break at a heading', () => {
    const doc = 'w'.repeat(10_000); // no boundaries at all
    const chunks = chunkDocument('d', doc, 2000, 400);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks[1].startChar).toBe(chunks[0].endChar - 400);
  });

  it('never loops forever on pathological input (heading-only doc, tiny chunks)', () => {
    const doc = Array.from({ length: 50 }, (_, i) => `## H${i}`).join('\n');
    const chunks = chunkDocument('d', doc, 40, 10);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(doc.length); // sane, not 1-char chunks
    expect(chunks[chunks.length - 1].endChar).toBe(doc.length);
  });
});

describe('chunkDocument — code fences and CRLF (swarm findings #20/#30)', () => {
  it('never treats # lines inside code fences as headings (no bogus § prefix, no fence splits)', () => {
    const fenced = '```sh\n# not a heading\n# also code\n```\n';
    const doc = `## Real Section\n\n${('prose '.repeat(60) + '\n\n' + fenced).repeat(12)}`;
    const chunks = chunkDocument('d', doc, 1500, 150);
    for (const c of chunks) {
      expect(c.text.startsWith('§ not a heading')).toBe(false);
      // every chunk has balanced fences — no chunk starts or ends mid-block
      const fences = (c.text.match(/^\s{0,3}```/gm) || []).length;
      expect(fences % 2, `chunk ${c.chunkIndex} splits a code fence:\n${c.text.slice(0, 200)}`).toBe(0);
    }
    expect(chunks.some(c => c.text.includes('§ Real Section'))).toBe(true);
  });

  it('CRLF documents snap to paragraph/heading boundaries instead of hard-cutting mid-word', () => {
    // paragraph spacing (~102 chars) < snap window (20% of 600 = 120), so a
    // boundary is always available — any mid-word cut is then a real bug
    const para = 'word '.repeat(20).trim();
    const doc = `## Sect A\r\n\r\n${Array(8).fill(para).join('\r\n\r\n')}\r\n\r\n## Sect B\r\n\r\n${Array(12).fill(para).join('\r\n\r\n')}`;
    const chunks = chunkDocument('d', doc, 600, 60);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks.slice(0, -1)) {
      // no chunk ends mid-word: boundary chars are whitespace/newline
      expect(/\s$/.test(c.text) || /^#{1,6} /.test(chunks[c.chunkIndex + 1]?.text?.trimStart() ?? '')).toBe(true);
    }
    expect(chunks.some(c => c.text.includes('§ Sect'))).toBe(true);
  });
});
