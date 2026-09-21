/**
 * Dependency-free HTML → readable Markdown-ish text (RCL-01).
 *
 * WHY NO DEPENDENCY — the capture path has to work in an `npx monomind`
 * install with nothing extra resolved, and the extension already runs
 * Readability against the live DOM. What lands here is the fallback for an
 * archive nobody cleaned: a small, predictable extractor beats a large one we
 * cannot install.
 *
 * WHY BOILERPLATE STRIPPING IS THE POINT — a site's nav, header, footer and
 * cookie banner are byte-identical on every page. Leave them in and every
 * document from that site chunks into near-identical text, so their embeddings
 * cluster on the chrome rather than the article and recall collapses. Dropping
 * a little real content is a far cheaper error than keeping the chrome.
 *
 * @module v1/cli/knowledge/html-extract
 */

import {
  BLOCK_TAGS,
  CELL_TAGS,
  CHROME_ROLES,
  CHROME_TAGS,
  CHROME_WORDS,
  decodeEntities,
  NON_TEXT_TAGS,
  RAW_TEXT_TAGS,
  VOID_TAGS,
} from './html-tags.js';

export { decodeEntities };

export interface HtmlExtractOptions {
  /** Drop nav/header/footer/aside/cookie-banner containers. Default true. */
  stripBoilerplate?: boolean;
}

export interface ExtractedHtml {
  /** `<title>` text, or null when the document has none. */
  title: string | null;
  /** Markdown-ish body text; headings as ATX, list items as `- `. */
  text: string;
}

// ── Tokenizer ──────────────────────────────────────────────────────

interface OpenTag {
  name: string;
  attrs: Record<string, string>;
  selfClosing: boolean;
}

type Token =
  | { t: 'open'; tag: OpenTag }
  | { t: 'close'; name: string }
  | { t: 'text'; value: string };

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+))?/g;

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m = ATTR_RE.exec(source);
  while (m) {
    const raw = m[2] ?? '';
    attrs[m[1].toLowerCase()] = decodeEntities(raw.replace(/^["']|["']$/g, ''));
    m = ATTR_RE.exec(source);
  }
  return attrs;
}

function* tokenize(html: string): Generator<Token> {
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      yield { t: 'text', value: html.slice(i) };
      return;
    }
    if (lt > i) yield { t: 'text', value: html.slice(i, lt) };

    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      yield { t: 'text', value: html.slice(lt + 9, end === -1 ? undefined : end) };
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      if (end === -1) {
        i = html.length;
        continue;
      }
      const name = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(html.slice(lt + 2, end).trim())?.[0];
      if (name) yield { t: 'close', name: name.toLowerCase() };
      i = end + 1;
      continue;
    }

    const nameMatch = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(html.slice(lt, lt + 80));
    if (!nameMatch) {
      // A bare `<` in prose, e.g. "a < b". Keep it as text.
      yield { t: 'text', value: '<' };
      i = lt + 1;
      continue;
    }
    const name = nameMatch[1].toLowerCase();

    // Walk to the tag's `>` while honouring quoted attribute values, so
    // `alt="a > b"` does not end the tag early.
    let j = lt + nameMatch[0].length;
    let quote = '';
    while (j < html.length) {
      const c = html[j];
      if (quote) {
        if (c === quote) quote = '';
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j++;
    }
    const inner = html.slice(lt + nameMatch[0].length, j);
    const selfClosing = inner.trimEnd().endsWith('/') || VOID_TAGS.has(name);
    yield { t: 'open', tag: { name, attrs: parseAttrs(inner), selfClosing } };
    i = j + 1;

    if (RAW_TEXT_TAGS.has(name) && !inner.trimEnd().endsWith('/')) {
      const rest = html.slice(i);
      const close = new RegExp(`</${name}\\s*>`, 'i').exec(rest);
      yield { t: 'text', value: close ? rest.slice(0, close.index) : rest };
      yield { t: 'close', name };
      i = close ? i + close.index + close[0].length : html.length;
    }
  }
}

// ── Drop decisions ─────────────────────────────────────────────────

function classTokens(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function isChromeAttrs(attrs: Record<string, string>): boolean {
  const role = attrs.role?.trim().toLowerCase();
  if (role?.split(/\s+/).some((r) => CHROME_ROLES.has(r))) return true;
  for (const key of ['class', 'id']) {
    const value = attrs[key];
    if (!value) continue;
    if (classTokens(value).some((w) => CHROME_WORDS.has(w))) return true;
  }
  return false;
}

function isHidden(attrs: Record<string, string>): boolean {
  if (attrs['aria-hidden']?.trim().toLowerCase() === 'true') return true;
  if ('hidden' in attrs) return true;
  const style = attrs.style;
  return !!style && /(?:^|;)\s*display\s*:\s*none/i.test(style);
}

// ── Block assembly ─────────────────────────────────────────────────

type BlockKind = 'heading' | 'li' | 'para' | 'pre' | 'quote';

interface Block {
  kind: BlockKind;
  text: string;
  level?: number;
  indent?: number;
}

/** The innermost open block decides how the buffered text renders — so a
 *  `<p>` nested inside an `<li>` still comes out as a bullet, not a
 *  paragraph. */
function resolveKind(openBlocks: string[]): { kind: BlockKind; level?: number; indent?: number } {
  for (let i = openBlocks.length - 1; i >= 0; i--) {
    const name = openBlocks[i];
    if (/^h[1-6]$/.test(name)) return { kind: 'heading', level: Number(name[1]) };
    if (name === 'li') {
      let indent = -1;
      for (let k = 0; k <= i; k++) if (openBlocks[k] === 'li') indent++;
      return { kind: 'li', indent: Math.max(0, indent) };
    }
    if (name === 'pre') return { kind: 'pre' };
    if (name === 'blockquote') return { kind: 'quote' };
  }
  return { kind: 'para' };
}

function render(blocks: Block[]): string {
  let out = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let line: string;
    if (b.kind === 'heading') line = `${'#'.repeat(Math.min(6, b.level ?? 1))} ${b.text}`;
    else if (b.kind === 'li') line = `${'  '.repeat(b.indent ?? 0)}- ${b.text}`;
    else if (b.kind === 'quote') line = `> ${b.text}`;
    else line = b.text;

    if (i === 0) out += line;
    else if (blocks[i - 1].kind === 'li' && b.kind === 'li') out += `\n${line}`;
    else out += `\n\n${line}`;
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Parse `html` into a title and clean block text.
 *
 * Unbalanced markup is expected — real archives are full of it — so closing a
 * tag pops back to its last matching open and a never-closed element simply
 * stays open until its parent closes. Nothing here throws.
 */
export function extractHtmlDocument(html: string, opts: HtmlExtractOptions = {}): ExtractedHtml {
  const stripBoilerplate = opts.stripBoilerplate !== false;
  const blocks: Block[] = [];
  const openBlocks: string[] = [];
  let buf = '';
  let title: string | null = null;
  let inTitle = false;

  // Drop state: the element being skipped and how deep we are inside nested
  // elements of the same name.
  let dropName: string | null = null;
  let dropNest = 0;

  const flush = (): void => {
    const resolved = resolveKind(openBlocks);
    let text = resolved.kind === 'pre' ? buf.replace(/[ \t]+$/gm, '') : buf.replace(/\s+/g, ' ');
    buf = '';
    text = text.replace(/\s*\|\s*$/, '').trim();
    if (!text) return;
    blocks.push({ kind: resolved.kind, text, level: resolved.level, indent: resolved.indent });
  };

  for (const token of tokenize(html)) {
    if (dropName) {
      if (token.t === 'open' && token.tag.name === dropName && !token.tag.selfClosing) dropNest++;
      else if (token.t === 'close' && token.name === dropName && --dropNest === 0) dropName = null;
      continue;
    }

    if (token.t === 'text') {
      if (inTitle) {
        title = decodeEntities(token.value).replace(/\s+/g, ' ').trim() || null;
      } else {
        buf += decodeEntities(token.value);
      }
      continue;
    }

    if (token.t === 'open') {
      const { name, attrs, selfClosing } = token.tag;

      if (name === 'title') {
        // Captured for the document heading, never emitted into the body.
        inTitle = true;
        continue;
      }

      const drop =
        NON_TEXT_TAGS.has(name) ||
        isHidden(attrs) ||
        (stripBoilerplate && (CHROME_TAGS.has(name) || isChromeAttrs(attrs)));

      if (drop) {
        flush();
        if (!selfClosing) {
          dropName = name;
          dropNest = 1;
        }
        continue;
      }

      if (BLOCK_TAGS.has(name)) {
        flush();
        if (!selfClosing) openBlocks.push(name);
      }
      if (name === 'img' && attrs.alt?.trim()) buf += ` ${attrs.alt.trim()} `;
      continue;
    }

    // close
    const { name } = token;
    if (name === 'title') {
      inTitle = false;
      continue;
    }
    if (CELL_TAGS.has(name)) {
      if (buf.trim()) buf = `${buf.trimEnd()} | `;
      continue;
    }
    if (BLOCK_TAGS.has(name)) {
      flush();
      const idx = openBlocks.lastIndexOf(name);
      if (idx !== -1) openBlocks.splice(idx);
    }
  }
  flush();

  return { title, text: render(blocks) };
}

/**
 * Clean text for an HTML document, with the `<title>` promoted to an `# h1`
 * when the page has no top-level heading of its own.
 */
export function htmlToMarkdown(html: string, opts: HtmlExtractOptions = {}): string {
  const doc = extractHtmlDocument(html, opts);
  if (!doc.title) return doc.text;
  if (/^# (?!#)/m.test(doc.text)) return doc.text;
  return doc.text ? `# ${doc.title}\n\n${doc.text}` : `# ${doc.title}`;
}
