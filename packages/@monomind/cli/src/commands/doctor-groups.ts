/**
 * Doctor output grouping: checks are shown under Required / Recommended /
 * Optional, passes are hidden unless asked for, and the run ends in one
 * "Next step" line. Presentation only — `--json` and exit codes never go
 * through here.
 */

import type { DoctorResult } from './doctor-json.js';

export type DoctorTier = 'Required' | 'Recommended' | 'Optional';

export const DOCTOR_TIERS: DoctorTier[] = ['Required', 'Recommended', 'Optional'];

/** Components the CLI cannot work without. */
const REQUIRED = new Set([
  'node',
  'npm',
  'claude',
  'config',
  'project-root',
  'memory',
  'disk',
  'git',
  'hook-settings',
]);

/** Components that only matter when the matching feature is used. */
const OPTIONAL = new Set([
  'documents',
  'jev',
  'crash-reporting',
  'platforms',
  'agent-runtimes',
  'claude-runtime',
  'second-brain',
  'kg',
  'monoes',
  'memory-pkg',
  'org-skills',
  'supply-chain',
  'appledouble',
  'api',
  'native',
  'typescript',
  'cost-settings',
]);

/** Everything not listed above is Recommended. */
export function doctorTier(component: string | undefined): DoctorTier {
  if (component && REQUIRED.has(component)) return 'Required';
  if (component && OPTIONAL.has(component)) return 'Optional';
  return 'Recommended';
}

/** Results to print: failures and warnings, plus everything when `showAll`. */
export function visibleResults(results: DoctorResult[], showAll: boolean): DoctorResult[] {
  return showAll ? results : results.filter((r) => r.status === 'fail' || r.status === 'warn');
}

/** Visible results split by tier, in Required / Recommended / Optional order. */
export function groupByTier(
  results: DoctorResult[],
  showAll: boolean,
): { tier: DoctorTier; results: DoctorResult[] }[] {
  const visible = visibleResults(results, showAll);
  return DOCTOR_TIERS.map((tier) => ({
    tier,
    results: visible.filter((r) => doctorTier(r.component) === tier),
  })).filter((g) => g.results.length > 0);
}

/**
 * One line telling the person what to do next: the first failure (Required
 * tier first), else the first warning, else nothing to do.
 */
export function nextStep(results: DoctorResult[]): string {
  const rank = (r: DoctorResult) => DOCTOR_TIERS.indexOf(doctorTier(r.component));
  const pick = (status: 'fail' | 'warn') =>
    results.filter((r) => r.status === status).sort((a, b) => rank(a) - rank(b))[0];
  const target = pick('fail') ?? pick('warn');
  if (!target) return 'Nothing to fix - you are ready to go (try: monomind status).';
  const action = target.fix ?? target.message;
  return `${target.name} - ${action}`.replace(/\s*\n\s*/g, ' ');
}
