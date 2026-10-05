// packages/@monomind/cli/src/orgrt/run-start.ts
/**
 * When a run started, read from its id. A run id is `run-<UTC YYYYMMDDHHMMSS>-<random>` (org-start-steps.ts)
 * and a resumed run keeps its id, so this gives the ORIGINAL start of a run on a fresh start and on every
 * resume, without a new field in any persisted file.
 */
export function runStartMs(run: string): number | undefined {
  const m = /^run-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})-/.exec(run);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(ms);
  // Date.UTC rolls an impossible date over (month 99): such an id is not a run id.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    ? ms
    : undefined;
}
