/**
 * #124: markdown.js — extracted from dashboard.html, where it was one of
 * four hand-copied markdown-to-HTML renderers with different escaping
 * coverage (this one was the most complete, so it became the shared
 * source instead of forcing the other three onto it sight-unseen). Zero
 * tests existed for any of the four before this.
 *
 * markdown.js is a classic (non-module) script — loaded via
 * <script src="markdown.js"> in dashboard.html so renderDocMarkdown/
 * gdCopyCode stay plain globals. Loaded here via vm so the same file the
 * browser gets is what's under test, not a rewritten/module-ified copy.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

let renderDocMarkdown: (md: string) => string;

beforeAll(() => {
  const source = readFileSync(join(__dirname, '..', 'src', 'ui', 'markdown.js'), 'utf-8');
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  renderDocMarkdown = sandbox.renderDocMarkdown as (md: string) => string;
});

describe('markdown.js: renderDocMarkdown', () => {
  it('renders headings with a slugified id', () => {
    expect(renderDocMarkdown('# Hello World')).toBe('<h1 id="hello-world">Hello World</h1>');
  });

  it('renders bold, italic, strikethrough, inline code', () => {
    const html = renderDocMarkdown('**bold** *italic* ~~gone~~ `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<del>gone</del>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders a fenced code block with a language label, HTML-escaped', () => {
    const html = renderDocMarkdown('```js\nconst x = "<a>";\n```');
    expect(html).toContain('gd-code-lang">js</span>');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('&lt;a&gt;');
    expect(html).not.toContain('<a>"');
  });

  it('renders a GFM table', () => {
    const html = renderDocMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(html).toBe('<div class="gd-table-wrap"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderDocMarkdown('- one\n- two')).toBe('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(renderDocMarkdown('1. first\n2. second')).toBe('<ol>\n<li>first</li>\n<li>second</li>\n</ol>');
  });

  it('renders a task list with checked/unchecked state', () => {
    const html = renderDocMarkdown('- [x] done\n- [ ] todo');
    expect(html).toContain('<input type="checkbox" disabled checked> done');
    expect(html).toContain('<input type="checkbox" disabled> todo');
  });

  it('#124: renders a blockquote as <blockquote> — was a pre-existing bug where the escape step ran before blockquote detection, so a source ">" became "&gt;" and never matched', () => {
    const html = renderDocMarkdown('> quoted text');
    expect(html).toBe('<blockquote><p>quoted text</p></blockquote>');
  });

  it('#124: blockquote inline formatting is not double-escaped', () => {
    const html = renderDocMarkdown('> has <tag> & **bold**');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).not.toContain('&amp;lt;');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('#124: nested blockquotes render as nested <blockquote> elements', () => {
    const html = renderDocMarkdown('> outer\n> > inner');
    expect(html).toBe('<blockquote><p>outer</p>\n<blockquote><p>inner</p></blockquote></blockquote>');
  });

  it('renders an external link with target=_blank and rel=noopener', () => {
    const html = renderDocMarkdown('[text](https://example.com/a?b=1)');
    expect(html).toContain('<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">text</a>');
  });

  it('does not add target=_blank to a relative link', () => {
    const html = renderDocMarkdown('[text](./relative)');
    expect(html).toContain('<a href="./relative">text</a>');
    expect(html).not.toContain('target');
  });

  it('#124: escapes a quote in a link href so it cannot break out of the attribute (previously interpolated raw)', () => {
    const html = renderDocMarkdown('[x](good"onmouseover="alert(1))'.replace(/\s/g, '_'));
    // The href value itself must never contain a bare, unescaped double quote.
    const hrefMatch = html.match(/href="([^"]*)"/);
    expect(hrefMatch).not.toBeNull();
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover=/);
  });

  it('#124: escapes a quote in an image src the same way', () => {
    const html = renderDocMarkdown('![alt](good"onerror="alert(1))'.replace(/\s/g, '_'));
    expect(html).not.toMatch(/src="[^"]*"[^>]*onerror=/);
  });

  it('strips a leading YAML frontmatter block', () => {
    const html = renderDocMarkdown('---\ntitle: x\n---\n# Real Title');
    expect(html).toBe('<h1 id="real-title">Real Title</h1>');
  });

  it('renders a horizontal rule', () => {
    expect(renderDocMarkdown('---')).toBe('<hr>');
  });

  it('sanitizes an inline HTML block: strips <script>, on* handlers, and javascript: URLs', () => {
    const html = renderDocMarkdown('<div onclick="evil()"><script>bad()</script><a href="javascript:evil()">x</a></div>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onclick=');
    expect(html).not.toContain('javascript:evil()');
    expect(html).toContain('<div>');
  });

  it('empty/falsy input returns an empty string', () => {
    expect(renderDocMarkdown('')).toBe('');
  });

  it('#124-review: blocks a javascript: URI in a markdown link (escAttr() alone only stops attribute-breakout, not scheme-based execution)', () => {
    const html = renderDocMarkdown('[click me](javascript:alert(document.cookie))');
    expect(html).toContain('href="#"');
    expect(html).not.toContain('javascript:');
  });

  it('#124-review: blocks a javascript: URI in a markdown image src', () => {
    const html = renderDocMarkdown('![img](javascript:alert(1))');
    expect(html).toContain('src="#"');
    expect(html).not.toContain('javascript:');
  });

  it('#124-review: still allows http(s)/mailto/tel and relative URLs', () => {
    expect(renderDocMarkdown('[a](https://example.com)')).toContain('href="https://example.com"');
    expect(renderDocMarkdown('[a](mailto:x@example.com)')).toContain('href="mailto:x@example.com"');
    expect(renderDocMarkdown('[a](./relative/path)')).toContain('href="./relative/path"');
  });

  it('#124-review: a fenced code block nested inside a blockquote renders its real content, not an empty block', () => {
    const html = renderDocMarkdown('> quote line\n> ```js\n> const x = 1;\n> ```\n> after');
    expect(html).toContain('const x = 1;');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('gd-code-lang">js</span>');
    expect(html).not.toContain('<pre><code></code></pre>'); // the bug's exact empty-block signature
  });

  it('#124-review: a top-level (non-blockquote) fenced code block still extracts and renders normally', () => {
    const html = renderDocMarkdown('```js\nconst y = 2;\n```');
    expect(html).toContain('const y = 2;');
    expect(html).toContain('class="language-js"');
  });
});
