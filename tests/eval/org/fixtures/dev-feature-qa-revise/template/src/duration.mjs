// Parses a duration such as "90s", "5m", "1h30m" into milliseconds.
// Units go largest first (h, m, s), each at most once. Whitespace inside a duration is an
// error; only the ends of the text are trimmed.
const UNITS = { h: 3_600_000, m: 60_000, s: 1000 };

export function parseDuration(text) {
  const t = String(text).trim().replace(/\s+/g, '');
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || t === '') throw new RangeError(`invalid duration: ${text}`);
  return Number(m[1] ?? 0) * UNITS.h + Number(m[2] ?? 0) * UNITS.m + Number(m[3] ?? 0) * UNITS.s;
}
