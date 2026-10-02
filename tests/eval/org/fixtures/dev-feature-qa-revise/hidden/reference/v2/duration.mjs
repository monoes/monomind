// The revision after QA's rejection: only the ends are trimmed, as the module's header says.
const UNITS = { h: 3_600_000, m: 60_000, s: 1000 };

export function parseDuration(text) {
  const t = String(text).trim();
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(t);
  const m = iso ?? /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  if (!m || t === '' || t === 'PT') throw new RangeError(`invalid duration: ${text}`);
  return Number(m[1] ?? 0) * UNITS.h + Number(m[2] ?? 0) * UNITS.m + Number(m[3] ?? 0) * UNITS.s;
}
