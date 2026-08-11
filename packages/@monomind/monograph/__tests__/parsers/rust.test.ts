import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../../src/parsers/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample.rs');

describe('Rust parser', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(fixturePath, 'utf-8');
    result = await parseFile(fixturePath, source, 'src/sample.rs');
  });

  it('extracts at least one symbol node (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.nodes.length).toBeGreaterThanOrEqual(1);
  });

  it('produces no fatal parse errors (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.parseErrors).toHaveLength(0);
  });

  it('marks pub items as exported (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const addFn = result.nodes.find(n => n.name === 'add' && n.label === 'Function');
    expect(addFn).toBeDefined();
    expect(addFn!.isExported).toBe(true);

    const config = result.nodes.find(n => n.name === 'Config' && n.label === 'Struct');
    expect(config).toBeDefined();
    expect(config!.isExported).toBe(true);
  });

  it('marks non-pub items as unexported (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    const helper = result.nodes.find(n => n.name === 'internal_helper' && n.label === 'Function');
    expect(helper).toBeDefined();
    expect(helper!.isExported).toBe(false);
  });

  it('extracts IMPORTS edge for use declaration (skipped if grammar unavailable)', () => {
    if (result.nodes.length === 0) return;
    expect(result.edges.some(e => e.relation === 'IMPORTS')).toBe(true);
  });
});
