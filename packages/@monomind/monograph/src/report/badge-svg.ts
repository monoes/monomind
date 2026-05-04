const CHAR_WIDTHS: Record<string, number> = {
  ' ': 33, '!': 37, '"': 42, '#': 67, '$': 67, '%': 80, '&': 80, "'": 24,
  '(': 40, ')': 40, '*': 47, '+': 70, ',': 33, '-': 40, '.': 33, '/': 47,
  '0': 67, '1': 67, '2': 67, '3': 67, '4': 67, '5': 67, '6': 67, '7': 67,
  '8': 67, '9': 67, ':': 37, ';': 37, '<': 70, '=': 70, '>': 70, '?': 60,
  '@': 117, 'A': 73, 'B': 73, 'C': 73, 'D': 80, 'E': 67, 'F': 60, 'G': 80,
  'H': 80, 'I': 27, 'J': 47, 'K': 73, 'L': 60, 'M': 87, 'N': 80, 'O': 87,
  'P': 67, 'Q': 87, 'R': 73, 'S': 67, 'T': 60, 'U': 80, 'V': 73, 'W': 100,
  'X': 67, 'Y': 67, 'Z': 67, '[': 40, '\\': 47, ']': 40, '^': 70, '_': 67,
  '`': 47, 'a': 60, 'b': 67, 'c': 53, 'd': 67, 'e': 60, 'f': 40, 'g': 67,
  'h': 67, 'i': 27, 'j': 27, 'k': 60, 'l': 27, 'm': 100, 'n': 67, 'o': 67,
  'p': 67, 'q': 67, 'r': 40, 's': 53, 't': 47, 'u': 67, 'v': 60, 'w': 80,
  'x': 60, 'y': 60, 'z': 53, '{': 40, '|': 32, '}': 40, '~': 70,
};

export function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += CHAR_WIDTHS[ch] ?? 67;
  return Math.ceil(w / 10);
}

export type HealthGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function gradeColor(grade: HealthGrade | string): string {
  switch (grade) {
    case 'A': return '#4c1';
    case 'B': return '#97ca00';
    case 'C': return '#dfb317';
    case 'D': return '#fe7d37';
    case 'F': return '#e05d44';
    default:   return '#9f9f9f';
  }
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function svgIdSuffix(label: string, message: string): string {
  return `${label}-${message}`.replace(/[^a-zA-Z0-9]/g, '-');
}

export interface BadgeOptions {
  label: string;
  message: string;
  color?: string;
  labelColor?: string;
  style?: 'flat' | 'flat-square' | 'plastic';
}

export function renderBadge(opts: BadgeOptions): string {
  const { label, message } = opts;
  const color = opts.color ?? '#4c1';
  const labelColor = opts.labelColor ?? '#555';
  const lw = textWidth(label) + 10;
  const mw = textWidth(message) + 10;
  const totalW = lw + mw;
  const idSuffix = svgIdSuffix(label, message);
  const lx = Math.floor(lw / 2);
  const mx = lw + Math.floor(mw / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="20" role="img" aria-label="${xmlEscape(label)}: ${xmlEscape(message)}">
  <title>${xmlEscape(label)}: ${xmlEscape(message)}</title>
  <linearGradient id="s-${idSuffix}" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r-${idSuffix}">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r-${idSuffix})">
    <rect width="${lw}" height="20" fill="${xmlEscape(labelColor)}"/>
    <rect x="${lw}" width="${mw}" height="20" fill="${xmlEscape(color)}"/>
    <rect width="${totalW}" height="20" fill="url(#s-${idSuffix})"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="110">
    <text aria-hidden="true" x="${lx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${lw * 10}">${xmlEscape(label)}</text>
    <text x="${lx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${lw * 10}">${xmlEscape(label)}</text>
    <text aria-hidden="true" x="${mx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${mw * 10}">${xmlEscape(message)}</text>
    <text x="${mx * 10}" y="140" transform="scale(.1)" fill="#fff" textLength="${mw * 10}">${xmlEscape(message)}</text>
  </g>
</svg>`;
}

export function renderHealthBadge(score: number, grade: string): string {
  return renderBadge({
    label: 'health',
    message: `${score} ${grade}`,
    color: gradeColor(grade),
  });
}

export function renderGradeBadge(label: string, grade: string): string {
  return renderBadge({ label, message: grade, color: gradeColor(grade) });
}
