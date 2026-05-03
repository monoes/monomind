export interface BadgeOptions {
  label?: string;      // left label text (default: 'monograph')
  value: string;       // right value text (e.g. 'A' or '87/100')
  color?: string;      // hex color (auto-determined from grade if omitted)
  uniqueId?: string;   // SVG element ID prefix (default: 'mg')
}

/** Map a letter grade to a shield-style hex color (without leading #). */
export function gradeToColor(grade: string): string {
  switch (grade.trim().toUpperCase()) {
    case 'A': return '4c1';
    case 'B': return '97ca00';
    case 'C': return 'dfb317';
    case 'D': return 'fe7d37';
    case 'F': return 'e05d44';
    default:  return '9f9f9f';
  }
}

/** Approximate text width using Verdana 11px metrics: ~6.5px per char + 10px padding. */
function textWidth(text: string): number {
  return Math.round(text.length * 6.5 + 10);
}

/**
 * Generate a self-contained shields.io-style SVG health-grade badge.
 * Returns the SVG string; callers can write it to a file or embed it inline.
 */
export function generateBadge(options: BadgeOptions): string {
  const label = options.label ?? 'monograph';
  const { value } = options;
  const id = options.uniqueId ?? 'mg';

  // Determine color: caller-supplied (strip leading #) or derived from grade
  let colorHex: string;
  if (options.color) {
    colorHex = options.color.replace(/^#/, '');
  } else {
    colorHex = gradeToColor(value);
  }

  const labelW = textWidth(label);
  const valueW = textWidth(value);
  const totalW = labelW + valueW;

  // X centres for text (SVG font-size="110" means 11px in a 10x-scaled coordinate space)
  const lx = Math.round(labelW / 2);
  const rx = labelW + Math.round(valueW / 2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="20">
  <linearGradient id="${id}-lg" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <rect width="${totalW}" height="20" rx="3" fill="#555"/>
  <rect x="${labelW}" width="${valueW}" height="20" rx="3" fill="#${colorHex}"/>
  <rect width="${totalW}" height="20" rx="3" fill="url(#${id}-lg)"/>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110">
    <text x="${lx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(labelW - 10) * 10}">${label}</text>
    <text x="${lx * 10}" y="140" transform="scale(.1)" textLength="${(labelW - 10) * 10}">${label}</text>
    <text x="${rx * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${value}</text>
    <text x="${rx * 10}" y="140" transform="scale(.1)" textLength="${(valueW - 10) * 10}">${value}</text>
  </g>
</svg>`;
}
