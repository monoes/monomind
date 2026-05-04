export interface SinceDuration {
  gitAfter: string;
  display: string;
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

export function parseSince(input: string): SinceDuration {
  if (isIsoDate(input)) return { gitAfter: input, display: input };
  const m = input.match(/^(\d+)([a-zA-Z]+)$/);
  if (!m) throw new Error(`--since requires a unit suffix (e.g., 6m, 90d, 1y), got: ${input}`);
  const num = parseInt(m[1], 10);
  if (num === 0) throw new Error('--since duration must be greater than 0');
  const unit = m[2].toLowerCase();
  if (unit === 'd' || unit === 'day' || unit === 'days') {
    const label = plural(num, 'day');
    return { gitAfter: `${label} ago`, display: label };
  }
  if (unit === 'w' || unit === 'week' || unit === 'weeks') {
    const label = plural(num, 'week');
    return { gitAfter: `${label} ago`, display: label };
  }
  if (unit === 'm' || unit === 'month' || unit === 'months') {
    const label = plural(num, 'month');
    return { gitAfter: `${label} ago`, display: label };
  }
  if (unit === 'y' || unit === 'year' || unit === 'years') {
    const label = plural(num, 'year');
    return { gitAfter: `${label} ago`, display: label };
  }
  throw new Error(`unknown duration unit '${unit}' in --since. Use d/w/m/y (e.g., 6m, 90d, 1y)`);
}

export function sinceDurationToGitFlag(s: SinceDuration): string {
  return `--after="${s.gitAfter}"`;
}
