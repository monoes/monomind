import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFile } from '../../src/parsers/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '../fixtures/sample.py');

describe('Python parser', () => {
  let result: Awaited<ReturnType<typeof parseFile>>;

  beforeAll(async () => {
    const source = readFileSync(fixturePath, 'utf-8');
    result = await parseFile(fixturePath, source, 'src/sample.py');
  });

  it('extracts the class', () => {
    expect(result.nodes.some(n => n.label === 'Class' && n.name === 'UserService')).toBe(true);
  });

  it('extracts the method', () => {
    expect(result.nodes.some(n => n.label === 'Method' && n.name === 'get_user')).toBe(true);
  });

  it('extracts the function', () => {
    expect(result.nodes.some(n => n.label === 'Function' && n.name === 'helper_fn')).toBe(true);
  });

  it('extracts IMPORTS edge for os.path', () => {
    expect(result.edges.some(e => e.relation === 'IMPORTS')).toBe(true);
  });
});
