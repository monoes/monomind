import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../../src/parsers/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample.ts');

describe('TypeScript parser', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(fixturePath, 'utf-8');
    result = await parseFile(fixturePath, source, 'src/sample.ts');
  });

  it('extracts the interface node', () => {
    expect(result.nodes.some(n => n.label === 'Interface' && n.name === 'UserService')).toBe(true);
  });

  it('extracts the class node', () => {
    expect(result.nodes.some(n => n.label === 'Class' && n.name === 'UserServiceImpl')).toBe(true);
  });

  it('extracts the function node', () => {
    expect(result.nodes.some(n => n.label === 'Function' && n.name === 'helperFn')).toBe(true);
  });

  it('extracts the method node', () => {
    expect(result.nodes.some(n => n.label === 'Method' && n.name === 'getUser')).toBe(true);
  });

  it('extracts the IMPLEMENTS edge', () => {
    expect(result.edges.some(e => e.relation === 'IMPLEMENTS')).toBe(true);
  });

  it('extracts the IMPORTS edge for fs/promises', () => {
    expect(result.edges.some(e => e.relation === 'IMPORTS' && e.targetId.includes('fs'))).toBe(true);
  });

  it('marks exported symbols', () => {
    const cls = result.nodes.find(n => n.name === 'UserServiceImpl');
    expect(cls?.isExported).toBe(true);
  });
});
