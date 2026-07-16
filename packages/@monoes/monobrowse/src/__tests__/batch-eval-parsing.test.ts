import { describe, it, expect } from 'vitest';
import { parseBatchCommandLine } from '../cli/commands.js';

describe('parseBatchCommandLine — eval expressions inside a batch command string', () => {
  it('does not strip string-literal quotes from a raw JS expression passed to eval', () => {
    // Regression: tokenizeBatchCommand's shell-style quote-stripping (correct for
    // space-separated args like `fill @e1 "some value"`) previously ran on eval's
    // expression too, silently deleting the expression's OWN string-literal quotes
    // and turning `document.querySelector('a')` into `document.querySelector(a)` —
    // a reference to an undefined identifier instead of a string literal.
    const input = "eval document.querySelector('meta[name=mm-token]').content";
    const { subName, subArgs } = parseBatchCommandLine(input);
    expect(subName).toBe('eval');
    expect(subArgs).toEqual(["document.querySelector('meta[name=mm-token]').content"]);
  });

  it('preserves double-quoted string literals in the expression too', () => {
    const input = 'eval document.querySelector("body").tagName';
    const { subName, subArgs } = parseBatchCommandLine(input);
    expect(subName).toBe('eval');
    expect(subArgs).toEqual(['document.querySelector("body").tagName']);
  });

  it('preserves an expression with multiple quoted segments and internal spaces', () => {
    const input = "eval [...document.querySelectorAll('li')].map(x => x.textContent.trim())";
    const { subName, subArgs } = parseBatchCommandLine(input);
    expect(subName).toBe('eval');
    expect(subArgs).toEqual(["[...document.querySelectorAll('li')].map(x => x.textContent.trim())"]);
  });

  it('still recognizes --json and --max-output flags placed before the expression', () => {
    const input = "eval --json --max-output 100 document.querySelector('a').href";
    const { subName, subArgs, flags } = parseBatchCommandLine(input);
    expect(subName).toBe('eval');
    expect(flags).toMatchObject({ json: true, 'max-output': 100 });
    expect(subArgs).toEqual(["document.querySelector('a').href"]);
  });

  it('leaves non-eval commands tokenized exactly as before (no behavior change)', () => {
    const input = 'fill @e1 "some value with spaces"';
    const { subName, subArgs } = parseBatchCommandLine(input);
    expect(subName).toBe('fill');
    expect(subArgs).toEqual(['@e1', 'some value with spaces']);
  });

  it('leaves a simple multi-token command tokenized exactly as before', () => {
    const input = 'open https://example.com --port 9333';
    const { subName, subArgs } = parseBatchCommandLine(input);
    expect(subName).toBe('open');
    expect(subArgs).toEqual(['https://example.com', '--port', '9333']);
  });
});
