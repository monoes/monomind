/**
 * Doctor — skill catalog check (`doctor -c catalog`). Re-hashes every entry
 * through `catalogAudit` and dry-plans both projection surfaces; never writes.
 */
import { PROJECTION_SURFACES, planProjection } from '../catalog/projection.js';
import { catalogAudit } from '../catalog/snapshot.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Skill Catalog';

export async function checkCatalog(
  root: string = process.cwd(),
  now: number = Date.now(),
): Promise<HealthCheck> {
  const audit = catalogAudit(root, now);
  if (!audit.configured)
    return {
      name: NAME,
      status: 'pass',
      message: 'Not configured (no .monomind/catalog/state.json)',
    };
  if (audit.error)
    return {
      name: NAME,
      status: 'fail',
      message: `Invalid .monomind/catalog/state.json: ${audit.error}`,
      fix: 'Repair .monomind/catalog/state.json by hand; catalog consumers ignore it until it parses',
    };

  const failures = audit.entries.filter((e) => e.status === 'active' && e.problems.length);
  if (failures.length)
    return {
      name: NAME,
      status: 'fail',
      message: failures.map((e) => `${e.id}: ${e.problems.join(', ')}`).join('; '),
      fix: failures.map((e) => `monomind catalog disable ${e.id} --actor <you>`).join('; '),
    };

  const warnings: string[] = [];
  const fixes: string[] = [];
  const activeIds = new Set(audit.entries.filter((e) => e.status === 'active').map((e) => e.id));
  for (const c of audit.legacyCollisions) {
    if (!activeIds.has(c.catalogId) || c.replacesLegacy) continue;
    warnings.push(
      `${c.catalogId} collides with ${c.legacyOrigin} legacy skill "${c.name}" (legacy wins)`,
    );
    fixes.push(
      `monomind catalog disable ${c.catalogId} --actor <you>, or stage a new revision and approve it with --replaces-legacy`,
    );
  }
  for (const s of audit.stale) {
    if (s.status !== 'staged' && s.status !== 'quarantined') continue;
    warnings.push(`${s.id} has been ${s.status} for ${s.ageDays} days`);
    fixes.push(`monomind catalog inspect ${s.id}, then approve or revoke it`);
  }
  for (const surface of PROJECTION_SURFACES) {
    const plan = await planProjection(root, surface);
    const drift = plan.diagnostics.filter((d) => d.includes('frontmatter-drift'));
    for (const r of plan.removals)
      warnings.push(`${r.id} is still projected to ${surface} but no longer eligible`);
    for (const d of drift) warnings.push(`${surface}: ${d}`);
    if (plan.removals.length || drift.length)
      fixes.push(`monomind catalog project --surface ${surface} --apply`);
  }

  const targets = Object.entries(audit.activeByTarget)
    .map(([t, n]) => `${t} ${n}`)
    .join(', ');
  const summary = `${audit.active} active, ${audit.entries.length} total${targets ? ` (${targets})` : ''}`;
  if (warnings.length)
    return {
      name: NAME,
      status: 'warn',
      message: `${summary}; ${warnings.join('; ')}`,
      fix: fixes.join('; '),
    };
  return { name: NAME, status: 'pass', message: summary };
}
