export type FallowOutputFormat = 'human' | 'json' | 'sarif' | 'compact' | 'markdown' | 'code-climate' | 'badge';

export const DEFAULT_OUTPUT_FORMAT: FallowOutputFormat = 'human';

const VALID_FORMATS = new Set<string>([
  'human', 'json', 'sarif', 'compact', 'markdown', 'code-climate', 'badge',
]);

const FORMAT_ALIASES: Record<string, FallowOutputFormat> = {
  codeclimate: 'code-climate',
  'gitlab-codequality': 'code-climate',
  'gitlab-code-quality': 'code-climate',
};

export function parseFallowOutputFormat(s: string): FallowOutputFormat | undefined {
  const normalized = s.toLowerCase();
  if (VALID_FORMATS.has(normalized)) return normalized as FallowOutputFormat;
  if (normalized in FORMAT_ALIASES) return FORMAT_ALIASES[normalized];
  return undefined;
}

export function isFallowOutputFormat(s: string): s is FallowOutputFormat {
  return VALID_FORMATS.has(s.toLowerCase());
}
