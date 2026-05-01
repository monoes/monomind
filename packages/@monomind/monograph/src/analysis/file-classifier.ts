import { extname } from 'path';

export type FileType = 'CODE' | 'DOCUMENT' | 'PAPER' | 'IMAGE' | 'VIDEO';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw', '.java', '.kt', '.kts', '.go',
  '.rs', '.rb', '.php', '.swift', '.cs', '.cpp',
  '.c', '.h', '.hpp', '.cc', '.m', '.r', '.scala',
  '.lua', '.sh', '.bash', '.zsh', '.ps1', '.psm1',
  '.sql', '.graphql', '.gql', '.proto', '.yaml', '.yml',
  '.toml', '.json', '.xml', '.html', '.css', '.scss',
  '.sass', '.less', '.vue', '.svelte', '.astro',
]);

const DOCUMENT_EXTENSIONS = new Set([
  '.md', '.mdx', '.rst', '.txt', '.pdf', '.docx',
  '.doc', '.odt', '.rtf', '.tex', '.adoc',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp',
  '.ico', '.bmp', '.tiff', '.tif',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv',
  '.wmv', '.m4v',
]);

const PAPER_URL_PATTERNS = [
  /arxiv\.org/,
  /semanticscholar\.org/,
  /openreview\.net/,
  /dl\.acm\.org/,
  /ieeexplore\.ieee\.org/,
  /springer\.com\/article/,
];

const PAPER_FILENAME_SIGNALS = [
  /(^|[^a-zA-Z])(attention|transformer|neural|deep.?learn|bert|gpt|llm|arxiv)([^a-zA-Z]|$)/i,
  /\d{4}\.\d{4,5}/,
];

export function classifyFile(pathOrUrl: string): FileType {
  if (PAPER_URL_PATTERNS.some(p => p.test(pathOrUrl))) return 'PAPER';

  const ext = extname(pathOrUrl).toLowerCase();

  if (IMAGE_EXTENSIONS.has(ext)) return 'IMAGE';
  if (VIDEO_EXTENSIONS.has(ext)) return 'VIDEO';

  if (DOCUMENT_EXTENSIONS.has(ext)) {
    if (ext === '.pdf' && PAPER_FILENAME_SIGNALS.some(p => p.test(pathOrUrl))) return 'PAPER';
    return 'DOCUMENT';
  }

  if (CODE_EXTENSIONS.has(ext)) return 'CODE';

  return 'CODE';
}

const PAPER_CONTENT_SIGNALS: RegExp[] = [
  /\\cite\{/,
  /\[\d{1,3}\](?:\[\d{1,3}\])+/,
  /\bEq(?:uation|n)?\.\s*\d+/i,
  /\bdoi:\s*10\.\d{4,}/i,
  /^Abstract\b/im,
  /\bWe propose\b/i,
  /\bProceedings\s+of\b/i,
  /\b(Journal|Preprint|arXiv)\b/i,
  /\d{4}\.\d{4,5}/,
  /\b\d+\(\d+\):\d+-\d+\b/,
  /\\bibliography\{/,
  /\bTable of Contents\b.*\n.*\bIntroduction\b/is,
];

const PAPER_CONTENT_THRESHOLD = 1;

export function classifyContent(text: string): FileType {
  const matches = PAPER_CONTENT_SIGNALS.filter(p => p.test(text)).length;
  if (matches >= PAPER_CONTENT_THRESHOLD) return 'PAPER';
  return 'DOCUMENT';
}
