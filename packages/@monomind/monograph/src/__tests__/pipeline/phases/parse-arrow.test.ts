import { describe, it, expect } from 'vitest';
import { extractArrowFunctions } from '../../../pipeline/phases/parse.js';

const ARROW_SOURCE = `
export const handleRequest = async (req, res) => {
  res.send('ok');
};

const helper = (x) => x * 2;
export const transform = (items) => items.map(helper);
`;

describe('parse phase arrow functions', () => {
  it('extracts named arrow functions as Function nodes', () => {
    const nodes = extractArrowFunctions(ARROW_SOURCE, '/tmp/handler.ts');
    const names = nodes.map(n => n.name);
    expect(names).toContain('handleRequest');
    expect(names).toContain('helper');
    expect(names).toContain('transform');
  });

  it('marks exported arrow functions as exported', () => {
    const nodes = extractArrowFunctions(ARROW_SOURCE, '/tmp/handler.ts');
    const handleRequest = nodes.find(n => n.name === 'handleRequest');
    expect(handleRequest?.isExported).toBe(true);
  });

  it('marks non-exported arrow functions as not exported', () => {
    const nodes = extractArrowFunctions(ARROW_SOURCE, '/tmp/handler.ts');
    const helper = nodes.find(n => n.name === 'helper');
    expect(helper?.isExported).toBe(false);
  });
});
