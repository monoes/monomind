import { createHash } from 'crypto';
import { validateUrl } from '../security/safe-fetch.js';
import { classifyFile } from '../analysis/file-classifier.js';

export type UrlType = 'paper' | 'github' | 'video' | 'webpage' | 'pdf' | 'image';

export interface IngestResult {
  id: string;
  url: string;
  type: UrlType;
  title: string;
  snippet: string;
  fetchedAt: string;
}

export interface IngestOptions {
  fetch?: typeof globalThis.fetch;
  maxBytes?: number;
}

const URL_TYPE_PATTERNS: Array<[RegExp, UrlType]> = [
  [/arxiv\.org|semanticscholar\.org|openreview\.net/, 'paper'],
  [/github\.com/, 'github'],
  [/youtube\.com|youtu\.be/, 'video'],
  [/\.pdf($|\?)/, 'pdf'],
];

export function classifyUrlType(url: string): UrlType {
  for (const [pattern, type] of URL_TYPE_PATTERNS) {
    if (pattern.test(url)) return type;
  }
  const fileType = classifyFile(url);
  if (fileType === 'IMAGE') return 'image';
  if (fileType === 'PAPER') return 'paper';
  return 'webpage';
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return m ? m[1].trim() : 'Untitled';
}

function extractSnippet(html: string, maxLen = 500): string {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLen);
}

export async function ingestUrl(url: string, options: IngestOptions = {}): Promise<IngestResult> {
  validateUrl(url);

  const { fetch: fetchFn = globalThis.fetch, maxBytes = 10 * 1024 * 1024 } = options;

  // Disable automatic redirect following so SSRF validation isn't bypassed by a redirect
  const response = await fetchFn(url, { redirect: 'error' } as RequestInit);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);

  const contentLength = response.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new Error(`Response too large: ${contentLength} bytes exceeds ${maxBytes}`);
  }

  const text = await response.text();
  if (text.length > maxBytes) throw new Error(`Response too large: body exceeds ${maxBytes} bytes`);

  const type = classifyUrlType(url);
  const contentType = response.headers.get('content-type') ?? '';
  const isHtml = contentType.includes('text/html') || text.trimStart().startsWith('<');

  const title = isHtml ? extractTitle(text) : (url.split('/').pop() ?? url);
  const snippet = isHtml ? extractSnippet(text) : text.slice(0, 500);

  return {
    id: createHash('sha256').update(url).digest('hex').slice(0, 16),
    url,
    type,
    title,
    snippet,
    fetchedAt: new Date().toISOString(),
  };
}
