// Data transform node handlers — datetime, html, markdown, xml.
// No external dependencies — uses only Node.js built-ins and native Date.
import type { NodeHandler, Item } from '../engine/index.js';

function getStr(config: Record<string, unknown>, key: string, fallback = ''): string {
  return String(config[key] ?? fallback);
}

function getField(item: Item, field: string): unknown {
  const parts = field.split('.');
  let val: unknown = item.data;
  for (const p of parts) {
    if (val === null || val === undefined || typeof val !== 'object') return undefined;
    val = (val as Record<string, unknown>)[p];
  }
  return val;
}

function setField(data: Record<string, unknown>, field: string, value: unknown): Record<string, unknown> {
  const result = { ...data };
  const parts = field.split('.');
  if (parts.length === 1) {
    result[field] = value;
    return result;
  }
  // Nested set (shallow clone at each level)
  const top = parts[0];
  const rest = parts.slice(1).join('.');
  const nested = (typeof result[top] === 'object' && result[top] !== null)
    ? { ...(result[top] as Record<string, unknown>) }
    : {};
  result[top] = setField(nested, rest, value);
  return result;
}

/** Parse a duration string like "24h", "30m", "7d", "60s" into milliseconds. */
function parseDuration(dur: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([smhd]?)$/.exec(dur.trim().toLowerCase());
  if (!match) return 0;
  const n = parseFloat(match[1]);
  const unit = match[2] || 's';
  const factors: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return n * (factors[unit] ?? 1000);
}

/** Format a Date using a simple format string (YYYY, MM, DD, HH, mm, ss). */
function formatDate(d: Date, fmt: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return fmt
    .replace('YYYY', String(d.getUTCFullYear()))
    .replace('MM', pad(d.getUTCMonth() + 1))
    .replace('DD', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours()))
    .replace('mm', pad(d.getUTCMinutes()))
    .replace('ss', pad(d.getUTCSeconds()));
}

const datetimeHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const operation = getStr(config, 'operation', 'now');
  const field = getStr(config, 'field', 'date');
  const outputField = getStr(config, 'output_field') || field;
  const format = getStr(config, 'format', 'YYYY-MM-DD');
  const duration = getStr(config, 'duration', '0s');
  const field2 = getStr(config, 'field2', '');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    let data = { ...item.data };

    if (operation === 'now') {
      data = setField(data, outputField || 'now', new Date().toISOString());
      results.push({ ...item, data });
      continue;
    }

    if (operation === 'format') {
      const raw = getField(item, field);
      const d = new Date(raw as string);
      if (isNaN(d.getTime())) {
        results.push({ ...item, data: setField(data, outputField, null) });
      } else {
        results.push({ ...item, data: setField(data, outputField, formatDate(d, format)) });
      }
      continue;
    }

    if (operation === 'parse') {
      const raw = getField(item, field);
      const d = new Date(raw as string);
      const ts = isNaN(d.getTime()) ? null : d.getTime();
      results.push({ ...item, data: setField(data, outputField, ts) });
      continue;
    }

    if (operation === 'add' || operation === 'subtract') {
      const raw = getField(item, field);
      const d = new Date(raw as string);
      if (isNaN(d.getTime())) {
        results.push({ ...item, data: setField(data, outputField, null) });
      } else {
        const ms = parseDuration(duration);
        const newTs = operation === 'add' ? d.getTime() + ms : d.getTime() - ms;
        results.push({ ...item, data: setField(data, outputField, new Date(newTs).toISOString()) });
      }
      continue;
    }

    if (operation === 'diff') {
      const raw1 = getField(item, field);
      const raw2 = getField(item, field2);
      const d1 = new Date(raw1 as string);
      const d2 = new Date(raw2 as string);
      const diffSeconds = (isNaN(d1.getTime()) || isNaN(d2.getTime()))
        ? null
        : Math.abs(d2.getTime() - d1.getTime()) / 1000;
      results.push({ ...item, data: setField(data, outputField || 'diff_seconds', diffSeconds) });
      continue;
    }

    results.push(item);
  }
  return results;
};

function htmlExtractText(html: string): string {
  // Remove script and style blocks first
  let out = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Replace block-level tags with newlines
  out = out.replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, '\n');
  // Strip remaining tags
  out = out.replace(/<[^>]+>/g, '');
  // Decode basic HTML entities
  out = out
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

function htmlExtractLinks(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const re = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    links.push({ href: m[1], text: htmlExtractText(m[2]).trim() });
  }
  return links;
}

function htmlSelect(html: string, selector: string): string[] {
  // Supports: tag, tag.class, tag#id, .class, #id
  const selectorRe = /^([a-z0-9]*)?(?:\.([a-z0-9_-]+))?(?:#([a-z0-9_-]+))?$/i.exec(selector.trim());
  if (!selectorRe) return [];

  const [, tag, cls, id] = selectorRe;
  const tagPart = tag || '[a-z][a-z0-9]*';
  const classAttr = cls ? `(?=[^>]*\\bclass\\s*=\\s*["'][^"']*\\b${cls}\\b)` : '';
  const idAttr = id ? `(?=[^>]*\\bid\\s*=\\s*["']${id}["'])` : '';
  const openTag = new RegExp(`<(${tagPart})${classAttr}${idAttr}[^>]*>`, 'gi');

  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = openTag.exec(html)) !== null) {
    const closingTag = new RegExp(`</${m[1]}>`, 'i');
    const start = m.index;
    const endMatch = closingTag.exec(html.slice(start));
    if (endMatch) {
      results.push(html.slice(start, start + endMatch.index + endMatch[0].length));
    } else {
      results.push(m[0]);
    }
  }
  return results;
}

function htmlSanitize(html: string): string {
  // Remove dangerous tags entirely (with content)
  let out = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  out = out.replace(/<object[\s\S]*?<\/object>/gi, '');
  out = out.replace(/<embed[^>]*>/gi, '');
  out = out.replace(/<form[\s\S]*?<\/form>/gi, '');
  // Remove event handler attributes
  out = out.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  out = out.replace(/\s+on\w+\s*=\s*[^\s>]+/gi, '');
  // Remove javascript: in href/src
  out = out.replace(/(href|src)\s*=\s*["']javascript:[^"']*["']/gi, '$1="#"');
  return out;
}

const htmlHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const operation = getStr(config, 'operation', 'extract_text');
  const field = getStr(config, 'field', 'html');
  const outputField = getStr(config, 'output_field') || operation;
  const selector = getStr(config, 'selector', '');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const raw = getField(item, field) ?? '';
    const html = String(raw);

    if (operation === 'extract_text') {
      results.push({ ...item, data: setField({ ...item.data }, outputField, htmlExtractText(html)) });
    } else if (operation === 'extract_links') {
      const links = htmlExtractLinks(html);
      // Return one item per link, or a single item with array if no links
      if (links.length === 0) {
        results.push({ ...item, data: setField({ ...item.data }, outputField, []) });
      } else {
        for (const link of links) {
          results.push({ ...item, data: { ...item.data, ...link } });
        }
      }
    } else if (operation === 'select') {
      const selected = htmlSelect(html, selector);
      results.push({ ...item, data: setField({ ...item.data }, outputField, selected) });
    } else if (operation === 'sanitize') {
      results.push({ ...item, data: setField({ ...item.data }, outputField, htmlSanitize(html)) });
    } else {
      results.push(item);
    }
  }
  return results;
};

function mdToHtml(md: string): string {
  let h = md;
  h = h.replace(/^###### (.+)$/gm, '<h6>$1</h6>').replace(/^##### (.+)$/gm, '<h5>$1</h5>');
  h = h.replace(/^#### (.+)$/gm, '<h4>$1</h4>').replace(/^### (.+)$/gm, '<h3>$1</h3>');
  h = h.replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
  h = h.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  h = h.replace(/__(.+?)__/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/^[-*+] (.+)$/gm, '<li>$1</li>').replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  h = h.replace(/(<li>[\s\S]*?<\/li>)(\s*<li>[\s\S]*?<\/li>)*/g, (m) => `<ul>${m}</ul>`);
  h = h.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>').replace(/^[-*_]{3,}$/gm, '<hr>');
  h = h.split(/\n{2,}/).map(block => {
    const t = block.trim();
    if (!t || /^<[a-z]/.test(t)) return t;
    return `<p>${t.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return h;
}

function mdToText(md: string): string {
  let t = md.replace(/^#{1,6} /gm, '');
  t = t.replace(/\*\*\*(.+?)\*\*\*/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
  t = t.replace(/__(.+?)__/g, '$1').replace(/_(.+?)_/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/^[-*+] /gm, '').replace(/^\d+\. /gm, '').replace(/^> /gm, '').replace(/^[-*_]{3,}$/gm, '');
  return t.trim();
}

function htmlToMd(html: string): string {
  let md = html;
  // Headings
  md = md.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n').replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n');
  md = md.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n').replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n');
  md = md.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n').replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n');
  md = md.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, '**$2**');
  md = md.replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, '*$2*');
  md = md.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  md = md.replace(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  md = md.replace(/<img\s[^>]*alt\s*=\s*["']([^"']*)["'][^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, '![$1]($2)');
  md = md.replace(/<img\s[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi, '![]($1)');
  md = md.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n').replace(/<\/(ul|ol)>/gi, '\n').replace(/<(ul|ol)[^>]*>/gi, '');
  md = md.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n').replace(/<br\s*\/?>/gi, '\n');
  md = md.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '> $1\n').replace(/<hr\s*\/?>/gi, '---\n');
  md = md.replace(/<[^>]+>/g, '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
  md = md.replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  return md.trim();
}

const markdownHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const operation = getStr(config, 'operation', 'to_html');
  const field = getStr(config, 'field', 'markdown');
  const outputField = getStr(config, 'output_field') || operation;

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const raw = String(getField(item, field) ?? '');

    if (operation === 'to_html') {
      results.push({ ...item, data: setField({ ...item.data }, outputField, mdToHtml(raw)) });
    } else if (operation === 'to_text') {
      results.push({ ...item, data: setField({ ...item.data }, outputField, mdToText(raw)) });
    } else if (operation === 'from_html') {
      results.push({ ...item, data: setField({ ...item.data }, outputField, htmlToMd(raw)) });
    } else {
      results.push(item);
    }
  }
  return results;
};

type XmlNode = { tag: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

function parseXml(xml: string): XmlNode {
  const root: XmlNode = { tag: '__root__', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];

  // Tokenise into opening tags, closing tags, and text
  const tokenRe = /<\/?[^>]+>|[^<]+/g;
  let m: RegExpExecArray | null;

  while ((m = tokenRe.exec(xml)) !== null) {
    const token = m[0];
    const current = stack[stack.length - 1];
    if (token.startsWith('</')) {
      stack.pop();
    } else if (token.startsWith('<') && !token.startsWith('<?') && !token.startsWith('<!')) {
      const selfClose = token.endsWith('/>');
      const inner = token.replace(/^</, '').replace(/\/?>$/, '').trim();
      const parts = inner.match(/\S+/g) ?? [];
      const tag = parts[0] ?? '';
      const attrs: Record<string, string> = {};
      const attrRe = /(\w[\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
      let am: RegExpExecArray | null;
      while ((am = attrRe.exec(inner.slice(tag.length))) !== null) {
        if (am[1] && am[1] !== tag) attrs[am[1]] = am[2] ?? am[3] ?? am[4] ?? '';
      }
      const node: XmlNode = { tag, attrs, children: [], text: '' };
      current.children.push(node);
      if (!selfClose) stack.push(node);
    } else if (!token.startsWith('<')) {
      if (current) current.text += token;
    }
  }

  return root.children[0] ?? root;
}

function xmlNodeToObj(node: XmlNode): unknown {
  if (node.children.length === 0) {
    const text = node.text.trim();
    if (Object.keys(node.attrs).length === 0) return text || null;
    return { _text: text, ...node.attrs };
  }
  const obj: Record<string, unknown> = { ...node.attrs };
  if (node.text.trim()) obj['_text'] = node.text.trim();
  for (const child of node.children) {
    const childVal = xmlNodeToObj(child);
    if (child.tag in obj) {
      const existing = obj[child.tag];
      if (Array.isArray(existing)) {
        (existing as unknown[]).push(childVal);
      } else {
        obj[child.tag] = [existing, childVal];
      }
    } else {
      obj[child.tag] = childVal;
    }
  }
  return obj;
}

function buildXml(obj: unknown, tag = 'root', indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return `${pad}<${tag}/>`;
  if (typeof obj !== 'object') return `${pad}<${tag}>${String(obj)}</${tag}>`;
  if (Array.isArray(obj)) {
    return (obj as unknown[]).map(item => buildXml(item, tag, indent)).join('\n');
  }
  const rec = obj as Record<string, unknown>;
  const children = Object.entries(rec)
    .filter(([k]) => k !== '_text' && !k.startsWith('@'))
    .map(([k, v]) => buildXml(v, k, indent + 1))
    .join('\n');
  const text = rec['_text'] ? String(rec['_text']) : '';
  const attrs = Object.entries(rec)
    .filter(([k]) => k.startsWith('@'))
    .map(([k, v]) => ` ${k.slice(1)}="${String(v)}"`)
    .join('');
  if (!children && !text) return `${pad}<${tag}${attrs}/>`;
  if (!children) return `${pad}<${tag}${attrs}>${text}</${tag}>`;
  return `${pad}<${tag}${attrs}>\n${children}\n${pad}</${tag}>`;
}

function xpathSelect(node: XmlNode, path: string): XmlNode[] {
  // Support simple paths: //tag or //tag/child or /tag/child
  const segments = path.replace(/^\/\/|^\//, '').split('/').filter(Boolean);
  const isDescendant = path.startsWith('//');

  function findAll(current: XmlNode, segs: string[], allowSkip: boolean): XmlNode[] {
    if (segs.length === 0) return [current];
    const [head, ...rest] = segs;
    const results: XmlNode[] = [];
    for (const child of current.children) {
      if (child.tag === head) {
        results.push(...findAll(child, rest, false));
      }
      if (allowSkip) {
        results.push(...findAll(child, segs, true));
      }
    }
    return results;
  }

  return findAll(node, segments, isDescendant);
}

const xmlHandler: NodeHandler = async (items: Item[], config: Record<string, unknown>): Promise<Item[]> => {
  const operation = getStr(config, 'operation', 'parse');
  const field = getStr(config, 'field', 'xml');
  const outputField = getStr(config, 'output_field') || operation;
  const xpath = getStr(config, 'xpath', '');

  const inputItems = items.length ? items : [{ data: {} }];
  const results: Item[] = [];

  for (const item of inputItems) {
    const raw = getField(item, field) ?? '';

    if (operation === 'parse') {
      try {
        const xmlStr = String(raw);
        const node = parseXml(xmlStr);
        const obj = xmlNodeToObj(node);
        results.push({ ...item, data: setField({ ...item.data }, outputField, obj) });
      } catch (err) {
        results.push({ ...item, data: setField({ ...item.data }, outputField, null) });
      }
    } else if (operation === 'build') {
      const obj = raw;
      const rootTag = getStr(config, 'root_tag', 'root');
      const xmlStr = buildXml(obj, rootTag);
      results.push({ ...item, data: setField({ ...item.data }, outputField, xmlStr) });
    } else if (operation === 'xpath') {
      try {
        const xmlStr = String(raw);
        const node = parseXml(xmlStr);
        const found = xpathSelect(node, xpath);
        const objs = found.map(n => xmlNodeToObj(n));
        results.push({ ...item, data: setField({ ...item.data }, outputField, objs) });
      } catch {
        results.push({ ...item, data: setField({ ...item.data }, outputField, []) });
      }
    } else {
      results.push(item);
    }
  }
  return results;
};

export function register(handlers: Map<string, NodeHandler>): void {
  handlers.set('data.datetime', datetimeHandler);
  handlers.set('data.html', htmlHandler);
  handlers.set('data.markdown', markdownHandler);
  handlers.set('data.xml', xmlHandler);
}
