import { getParser, isSupportedExtension } from '../../src/parsers/loader.js';

describe('isSupportedExtension', () => {
  it('recognises .ts', () => expect(isSupportedExtension('.ts')).toBe(true));
  it('recognises .py', () => expect(isSupportedExtension('.py')).toBe(true));
  it('rejects .css', () => expect(isSupportedExtension('.css')).toBe(false));
});

describe('getParser', () => {
  it('returns a parser for TypeScript', async () => {
    const parser = await getParser('.ts');
    expect(parser).toBeDefined();
  });
});
