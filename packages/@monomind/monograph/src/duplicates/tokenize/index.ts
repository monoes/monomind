import type { FileTokens, SourceToken } from '../token-types.js';
import { emptyTokens } from '../token-types.js';
import * as path from 'node:path';

const STYLE_EXTS = new Set(['.css', '.scss', '.sass', '.less', '.styl']);
const SFC_EXTS = new Set(['.vue', '.svelte']);
const SCRIPT_OPEN_RE = /<script(?:[^>]*lang=["'](?:ts|typescript)["'][^>]*)?\s*>/i;
const SCRIPT_CLOSE_RE = /<\/script>/i;

export function tokenizeFile(filePath: string, source: string, skipImports: boolean): FileTokens {
  const ext = path.extname(filePath).toLowerCase();
  if (STYLE_EXTS.has(ext)) return emptyTokens(source);
  if (SFC_EXTS.has(ext)) return tokenizeSfc(source, false, skipImports);
  if (ext === '.astro') return tokenizeAstro(source, false, skipImports);
  if (ext === '.mdx') return tokenizeMdx(source, false, skipImports);
  return tokenizeJsTs(filePath, source, false, skipImports);
}

export function tokenizeFileCrossLanguage(
  filePath: string,
  source: string,
  stripTypes: boolean,
  skipImports: boolean,
): FileTokens {
  const ext = path.extname(filePath).toLowerCase();
  if (STYLE_EXTS.has(ext)) return emptyTokens(source);
  if (SFC_EXTS.has(ext)) return tokenizeSfc(source, stripTypes, skipImports);
  if (ext === '.astro') return tokenizeAstro(source, stripTypes, skipImports);
  if (ext === '.mdx') return tokenizeMdx(source, stripTypes, skipImports);
  return tokenizeJsTs(filePath, source, stripTypes, skipImports);
}

export function tokenizeSfc(source: string, stripTypes: boolean, skipImports: boolean): FileTokens {
  const scriptMatch = source.match(SCRIPT_OPEN_RE);
  if (!scriptMatch) return emptyTokens(source);
  const start = source.indexOf(scriptMatch[0]) + scriptMatch[0].length;
  const closeMatch = source.slice(start).match(SCRIPT_CLOSE_RE);
  if (!closeMatch) return emptyTokens(source);
  const scriptSource = source.slice(start, start + closeMatch.index!);
  return tokenizeJsTs('component.ts', scriptSource, stripTypes, skipImports);
}

export function tokenizeAstro(source: string, stripTypes: boolean, skipImports: boolean): FileTokens {
  const frontmatterEnd = source.indexOf('---', 3);
  if (!source.startsWith('---') || frontmatterEnd === -1) return emptyTokens(source);
  const frontmatter = source.slice(3, frontmatterEnd);
  return tokenizeJsTs('astro.ts', frontmatter, stripTypes, skipImports);
}

export function tokenizeMdx(source: string, stripTypes: boolean, skipImports: boolean): FileTokens {
  const lines = source.split('\n');
  const codeLines = lines.filter(l => l.match(/^(import|export)\s/));
  return tokenizeJsTs('mdx.ts', codeLines.join('\n'), stripTypes, skipImports);
}

export function tokenizeJsTs(
  _filePath: string,
  source: string,
  _stripTypes: boolean,
  skipImports: boolean,
): FileTokens {
  const lineCount = (source.match(/\n/g)?.length ?? 0) + 1;
  const tokens: SourceToken[] = [];
  const tokenRe = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([a-zA-Z_$][a-zA-Z0-9_$]*)|([^\s\w"'`])/g;
  const KEYWORDS = new Set([
    'var','let','const','function','return','if','else','for','while','do',
    'switch','case','break','continue','default','throw','try','catch','finally',
    'new','delete','typeof','instanceof','in','of','void','this','super',
    'class','extends','import','export','from','as','async','await','yield',
    'static','get','set','type','interface','enum','implements','abstract',
    'declare','readonly','keyof','satisfies','true','false','null',
  ]);
  const IMPORT_KWS = new Set(['import','export','from','require']);

  let inImport = false;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(source)) !== null) {
    const raw = match[0];
    if (raw.startsWith('//') || raw.startsWith('/*')) continue;
    const pos = match.index;
    const span = { start: pos, end: pos + raw.length };

    if (match[2]) {
      const word = match[2];
      if (word === 'import' || word === 'export') inImport = true;
      else if (word === ';' || word === '\n') inImport = false;
      if (skipImports && inImport && IMPORT_KWS.has(word)) continue;
      if (word === 'true' || word === 'false') {
        tokens.push({ kind: { kind: 'BooleanLiteral', value: word === 'true' }, span });
      } else if (word === 'null') {
        tokens.push({ kind: { kind: 'NullLiteral' }, span });
      } else if (KEYWORDS.has(word)) {
        tokens.push({ kind: { kind: 'Keyword', kwType: word.charAt(0).toUpperCase() + word.slice(1) as any }, span });
      } else {
        tokens.push({ kind: { kind: 'Identifier', name: word }, span });
      }
    } else if (match[1]) {
      tokens.push({ kind: { kind: 'NumericLiteral' }, span });
    } else if (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith('`')) {
      tokens.push({ kind: { kind: raw.startsWith('`') ? 'TemplateLiteral' : 'StringLiteral' }, span });
    }
  }
  return { tokens, source, lineCount };
}
