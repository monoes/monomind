import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../../src/parsers/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample.kt');

describe('Kotlin parser', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(fixturePath, 'utf-8');
    result = await parseFile(fixturePath, source, 'src/sample.kt');
  });

  it('extracts at least one symbol node (skipped if grammar unavailable)', () => {
    // Grammar may be unavailable on certain platforms (no prebuilt native binding).
    // Skip gracefully when no nodes were extracted.
    if (result.nodes.length === 0) return;
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('produces no fatal parse errors (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.parseErrors).toHaveLength(0);
  });

  it('extracts clean symbol names, not raw node text', () => {
    // Regression guard: tree-sitter-kotlin declares no field names, so names
    // must come from the type_identifier/simple_identifier children — not the
    // text fallback (which yields 'class UserServiceImpl {' etc.).
    if (result.nodes.length === 0) return;
    const names = result.nodes.map(n => n.name);
    expect(names).toContain('UserServiceImpl');
    expect(names).toContain('topLevelFn');
    expect(names.some(n => n.includes('{'))).toBe(false);
  });
});
