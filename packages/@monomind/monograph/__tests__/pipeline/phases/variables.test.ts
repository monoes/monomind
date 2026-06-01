import { describe, it, expect } from 'vitest';
import { extractVariables } from '../../../src/pipeline/phases/variables.js';

describe('extractVariables', () => {
  it('extracts top-level const declarations', () => {
    const src = `export const MAX_RETRIES = 3;\nconst DEFAULT_TIMEOUT = 5000;`;
    const vars = extractVariables(src, 'src/config.ts');
    expect(vars.some(v => v.name === 'MAX_RETRIES' && v.isExported)).toBe(true);
    expect(vars.some(v => v.name === 'DEFAULT_TIMEOUT' && !v.isExported)).toBe(true);
  });

  it('extracts let declarations', () => {
    const src = `let count = 0;\nexport let currentUser: User | null = null;`;
    const vars = extractVariables(src, 'src/state.ts');
    expect(vars.some(v => v.name === 'count')).toBe(true);
    expect(vars.some(v => v.name === 'currentUser' && v.isExported)).toBe(true);
  });

  it('does not extract variables inside functions', () => {
    const src = `function fn() { const inner = 1; }\nconst outer = 2;`;
    const vars = extractVariables(src, 'src/a.ts');
    expect(vars.some(v => v.name === 'outer')).toBe(true);
    expect(vars.some(v => v.name === 'inner')).toBe(false);
  });

  it('returns empty array for files with no variables', () => {
    const src = `class Foo {}`;
    expect(extractVariables(src, 'src/a.ts')).toHaveLength(0);
  });
});
