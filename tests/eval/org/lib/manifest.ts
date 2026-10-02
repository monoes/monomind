// tests/eval/org/lib/manifest.ts
//
// A paid scenario's required-output manifest and qualification contract (org
// sections spec, section 10). It is committed before tuning or any paid trial,
// and `validateManifest` refuses one with an unspecified field, because a gate
// whose floors are set after seeing results is not a gate.
//
// Dependency-free on purpose: this tree sits outside the packages.

export interface ManifestUnit {
  id: string;
  description: string;
  /** How many distinct accepted artifacts of this unit the fixture requires. */
  count: number;
  output_class: string;
  /** Machine-checkable evidence, or the reviewer acceptance that stands in for it. */
  evidence: string;
}

export interface ScenarioManifest {
  id: string;
  title: string;
  /** ISO date the manifest was committed; it must precede the first paid trial. */
  committed_at: string;
  units: ManifestUnit[];
  /** When a whole fixture counts as completed. */
  completion_rule: string;
  rubric: {
    criteria: { id: string; description: string }[];
    /** Fraction of criteria a unit must pass to be accepted. */
    min_quality: number;
    /** A single one of these fails a unit whatever else it scores. */
    critical_failures: string[];
    /** The quality loss, as a fraction, a cheaper contender may show and still be non-inferior. */
    non_inferiority_margin: number;
  };
  qualification: {
    /** Minimum probability that a run produces a fully accepted fixture. */
    min_fixture_success_probability: number;
    max_human_interventions: number;
    deadline_minutes: number;
    allowed_recovery: string[];
  };
  analysis: {
    confidence: number;
    primary_comparisons: string[];
    /** One complete run; fragmenting a run into samples is not allowed. */
    sampling_unit: 'complete-run';
  };
  cost: {
    basis: 'attributable-billing' | 'estimated-inference';
    /** Planned exposure per run. Never a maximum charge. */
    planning_allocation_usd: number;
  };
}

export interface ManifestCheck {
  ok: boolean;
  problems: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateManifest(raw: unknown): ManifestCheck {
  const problems: string[] = [];
  if (!isObj(raw)) return { ok: false, problems: ['manifest must be an object'] };
  const str = (o: Record<string, unknown>, k: string, path: string): void => {
    if (typeof o[k] !== 'string' || (o[k] as string).trim() === '')
      problems.push(`${path} is required (non-empty text)`);
  };
  const num = (
    o: Record<string, unknown>,
    k: string,
    path: string,
    ok: (n: number) => boolean,
    rule: string,
  ): void => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || !ok(v))
      problems.push(`${path} is required and must be ${rule}`);
  };
  const list = (o: Record<string, unknown>, k: string, path: string): unknown[] | undefined => {
    const v = o[k];
    if (!Array.isArray(v) || v.length === 0) {
      problems.push(`${path} is required (at least one entry)`);
      return undefined;
    }
    return v;
  };
  const section = (k: string): Record<string, unknown> | undefined => {
    if (!isObj(raw[k])) {
      problems.push(`${k} is required`);
      return undefined;
    }
    return raw[k] as Record<string, unknown>;
  };

  str(raw, 'id', 'id');
  str(raw, 'title', 'title');
  str(raw, 'completion_rule', 'completion_rule');
  if (
    typeof raw.committed_at !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(raw.committed_at) ||
    Number.isNaN(Date.parse(raw.committed_at))
  )
    problems.push('committed_at is required and must be an ISO date (YYYY-MM-DD)');

  const units = list(raw, 'units', 'units');
  const seen = new Set<string>();
  units?.forEach((u, i) => {
    const p = `units[${i}]`;
    if (!isObj(u)) return void problems.push(`${p} must be an object`);
    str(u, 'id', `${p}.id`);
    str(u, 'description', `${p}.description`);
    str(u, 'output_class', `${p}.output_class`);
    str(u, 'evidence', `${p}.evidence`);
    num(u, 'count', `${p}.count`, (n) => Number.isInteger(n) && n > 0, 'a positive integer');
    if (typeof u.id === 'string') {
      if (seen.has(u.id)) problems.push(`duplicate unit id "${u.id}"`);
      seen.add(u.id);
    }
  });

  const rubric = section('rubric');
  if (rubric) {
    list(rubric, 'criteria', 'rubric.criteria')?.forEach((c, i) => {
      if (!isObj(c)) return void problems.push(`rubric.criteria[${i}] must be an object`);
      str(c, 'id', `rubric.criteria[${i}].id`);
      str(c, 'description', `rubric.criteria[${i}].description`);
    });
    num(
      rubric,
      'min_quality',
      'rubric.min_quality',
      (n) => n > 0 && n <= 1,
      'above 0 and at most 1',
    );
    list(rubric, 'critical_failures', 'rubric.critical_failures');
    num(
      rubric,
      'non_inferiority_margin',
      'rubric.non_inferiority_margin',
      (n) => n >= 0 && n < 1,
      'at least 0 and below 1',
    );
  }

  const q = section('qualification');
  if (q) {
    num(
      q,
      'min_fixture_success_probability',
      'qualification.min_fixture_success_probability',
      (n) => n > 0 && n <= 1,
      'above 0 and at most 1',
    );
    num(
      q,
      'max_human_interventions',
      'qualification.max_human_interventions',
      (n) => Number.isInteger(n) && n >= 0,
      'a whole number, 0 or more',
    );
    num(q, 'deadline_minutes', 'qualification.deadline_minutes', (n) => n > 0, 'positive');
    list(q, 'allowed_recovery', 'qualification.allowed_recovery');
  }

  const a = section('analysis');
  if (a) {
    num(a, 'confidence', 'analysis.confidence', (n) => n > 0 && n < 1, 'above 0 and below 1');
    list(a, 'primary_comparisons', 'analysis.primary_comparisons');
    if (a.sampling_unit !== 'complete-run')
      problems.push('analysis.sampling_unit is required and must be "complete-run"');
  }

  const c = section('cost');
  if (c) {
    if (c.basis !== 'attributable-billing' && c.basis !== 'estimated-inference')
      problems.push(
        'cost.basis is required and must be "attributable-billing" or "estimated-inference"',
      );
    num(c, 'planning_allocation_usd', 'cost.planning_allocation_usd', (n) => n > 0, 'positive');
  }

  return { ok: problems.length === 0, problems };
}
