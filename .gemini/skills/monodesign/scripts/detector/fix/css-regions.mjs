/**
 * CSS region extraction and declaration scanning for the auto-fix engine.
 *
 * Fixers never parse a full DOM — they operate on the raw source text of the
 * "CSS-shaped" regions of a file:
 *   - whole file for .css/.scss/.sass/.less
 *   - <style> blocks and style="" attributes for HTML-family files
 *   - styled-components / emotion template literals for JS/TS files
 *
 * All offsets returned here are absolute within the original file content, so
 * edits computed against a region can be applied directly to the file.
 */

const CSS_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less']);
const HTML_FAMILY_EXTENSIONS = new Set(['.html', '.htm', '.vue', '.svelte', '.astro']);
const JS_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

/**
 * A region of file content that can be scanned as CSS declarations.
 * kind:
 *   'css'        — full stylesheet syntax (selectors + blocks)
 *   'style-attr' — a bare declaration list from a style="" attribute;
 *                  selectorHint carries the owning tag name
 */
function extractCssRegions(content, ext) {
  ext = (ext || '').toLowerCase();
  if (CSS_EXTENSIONS.has(ext)) {
    return [{ start: 0, end: content.length, text: content, kind: 'css', selectorHint: null }];
  }

  const regions = [];
  if (HTML_FAMILY_EXTENSIONS.has(ext)) {
    const styleBlockRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
    let m;
    while ((m = styleBlockRe.exec(content)) !== null) {
      const start = m.index + m[0].indexOf(m[1]);
      regions.push({ start, end: start + m[1].length, text: m[1], kind: 'css', selectorHint: null });
    }
    const styleAttrRe = /<([a-zA-Z][\w-]*)\b[^>]*?\sstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
    while ((m = styleAttrRe.exec(content)) !== null) {
      const value = m[3] !== undefined ? m[3] : m[4];
      if (!value) continue;
      const start = m.index + m[0].length - value.length - 1; // inside the closing quote
      regions.push({
        start,
        end: start + value.length,
        text: value,
        kind: 'style-attr',
        selectorHint: m[1].toLowerCase(),
      });
    }
    return regions;
  }

  if (JS_EXTENSIONS.has(ext)) {
    const cssInJsRe = /(?:styled(?:\.\w+|\([^)]+\))|css)\s*`([\s\S]*?)`/g;
    let m;
    while ((m = cssInJsRe.exec(content)) !== null) {
      const start = m.index + m[0].indexOf('`') + 1;
      regions.push({ start, end: start + m[1].length, text: m[1], kind: 'css', selectorHint: null });
    }
    return regions;
  }

  return regions;
}

/**
 * Find every `prop: value` declaration in a CSS-shaped text. Returns local
 * offsets (relative to the given text):
 *   { declStart, valueStart, valueEnd, value, terminator }
 * `value` is the raw trimmed value text (may include !important).
 * `terminator` is the index just past the trailing `;` when present,
 * otherwise valueEnd.
 */
function findDeclarations(text, prop) {
  const re = new RegExp(`(^|[{;])(\\s*)(${prop})\\s*:\\s*([^;{}]*)`, 'gi');
  const results = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const declStart = m.index + m[1].length + m[2].length;
    const rawValue = m[4];
    const trimmed = rawValue.replace(/\s+$/, '');
    const valueStart = m.index + m[0].length - rawValue.length;
    const valueEnd = valueStart + trimmed.length;
    const terminator = text[m.index + m[0].length] === ';'
      ? m.index + m[0].length + 1
      : valueEnd;
    results.push({ declStart, valueStart, valueEnd, value: trimmed.trim(), terminator });
  }
  return results;
}

/**
 * The enclosing `{ ... }` block for a declaration at `index`, with its
 * selector text. For bare declaration lists (style attributes) there is no
 * block — the whole text is the body and selector is null.
 */
function declBlockInfo(text, index) {
  let i = index - 1;
  let depth = 0;
  while (i >= 0) {
    const ch = text[i];
    if (ch === '}') depth++;
    else if (ch === '{') {
      if (depth === 0) break;
      depth--;
    }
    i--;
  }
  if (i < 0) {
    return { bodyStart: 0, bodyEnd: text.length, body: text, selector: null };
  }
  const braceIdx = i;
  let s = braceIdx - 1;
  while (s >= 0 && !'};{'.includes(text[s])) s--;
  const selector = text.slice(s + 1, braceIdx).trim();
  let j = braceIdx + 1;
  let d = 0;
  while (j < text.length) {
    const ch = text[j];
    if (ch === '{') d++;
    else if (ch === '}') {
      if (d === 0) break;
      d--;
    }
    j++;
  }
  return { bodyStart: braceIdx + 1, bodyEnd: j, body: text.slice(braceIdx + 1, j), selector };
}

/** Parse a single CSS length/number value, tolerating !important. */
function parseCssValue(raw) {
  const important = /!\s*important/i.test(raw);
  const cleaned = raw.replace(/!\s*important/i, '').trim();
  const m = cleaned.match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!m) return null;
  return { num: parseFloat(m[1]), unit: (m[2] || '').toLowerCase(), important };
}

/** Resolve a block's font-size to px when statically computable, else null. */
function blockFontSizePx(body) {
  const decls = findDeclarations(body, 'font-size');
  if (decls.length === 0) return null;
  const parsed = parseCssValue(decls[decls.length - 1].value);
  if (!parsed) return null;
  if (parsed.unit === 'px') return parsed.num;
  if (parsed.unit === 'rem') return parsed.num * 16;
  return null;
}

/** Split a CSS value list on top-level commas (paren-aware, for cubic-bezier). */
function splitTopLevel(value) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export {
  CSS_EXTENSIONS,
  HTML_FAMILY_EXTENSIONS,
  JS_EXTENSIONS,
  extractCssRegions,
  findDeclarations,
  declBlockInfo,
  parseCssValue,
  blockFontSizePx,
  splitTopLevel,
};
