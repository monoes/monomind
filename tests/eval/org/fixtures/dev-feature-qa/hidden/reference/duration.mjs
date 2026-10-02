// A reference solution, used only to prove the fixture is solvable and the acceptance tests fair.
const UNITS = { h: 3_600_000, m: 60_000, s: 1000 };

function parseParts(body, pattern, scale) {
  const m = pattern.exec(body);
  if (!m || m.slice(1).every((p) => p === undefined)) return undefined;
  return m
    .slice(1)
    .reduce((sum, part, i) => (part === undefined ? sum : sum + Number(part) * scale[i]), 0);
}

export function parseDuration(text) {
  const t = String(text).trim();
  const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(t);
  const ms = iso
    ? parseParts(t, /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/, [UNITS.h, UNITS.m, UNITS.s])
    : parseParts(t, /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/, [UNITS.h, UNITS.m, UNITS.s]);
  if (ms === undefined) throw new RangeError(`invalid duration: ${text}`);
  return ms;
}
