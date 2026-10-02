// Parses a duration such as "90s", "5m" or "2h" into milliseconds.
const UNITS = { s: 1000, m: 60_000, h: 3_600_000 };

export function parseDuration(text) {
  const m = /^(\d+)([smh])$/.exec(String(text).trim());
  if (!m) throw new RangeError(`invalid duration: ${text}`);
  return Number(m[1]) * UNITS[m[2]];
}
