import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeAll, describe, expect, it } from 'vitest';

let md: (s: string) => string;

beforeAll(() => {
  const source = readFileSync(join(__dirname, '..', 'ui', 'markdown.js'), 'utf-8');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  md = sandbox.renderDocMarkdown as (s: string) => string;
});

describe('markdown.js: nested lists', () => {
  it('nests an indented item inside its parent li', () => {
    expect(md('- a\n  - b\n- c')).toBe(
      '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n<li>c</li>\n</ul>',
    );
  });

  it('keeps a bullet under an ordered item inside the same ol', () => {
    const html = md('1. one\n   - sub\n2. two');
    expect(html.match(/<ol>/g)).toHaveLength(1);
    expect(html).toBe('<ol>\n<li>one\n<ul>\n<li>sub</li>\n</ul></li>\n<li>two</li>\n</ol>');
  });

  it('nests an ordered list in a bullet and unwinds several levels at once', () => {
    const html = md('- a\n  1. b\n    - c\n- d');
    expect(html).toBe(
      '<ul>\n<li>a\n<ol>\n<li>b\n<ul>\n<li>c</li>\n</ul></li>\n</ol></li>\n<li>d</li>\n</ul>',
    );
  });

  it('switching list type at the same indent starts a new list', () => {
    expect(md('- a\n1. b')).toBe('<ul>\n<li>a</li>\n</ul>\n<ol>\n<li>b</li>\n</ol>');
  });

  it('still escapes raw HTML in nested items', () => {
    const html = md('- a\n  - <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('closes every open level at a blank line', () => {
    expect(md('- a\n  - b\n\ntext')).toBe(
      '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul></li>\n</ul>\n<p>text</p>',
    );
  });
});
