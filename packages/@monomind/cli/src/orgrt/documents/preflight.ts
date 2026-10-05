// packages/@monomind/cli/src/orgrt/documents/preflight.ts
/**
 * GA row R6 (spec 9.3; 6.14 role replacement; 7.3 pending probes): the
 * environment probes a sections org needs before it starts, resumes or replaces
 * a role. Validation cannot run them (it may run on another host), so they run
 * here, on the host that is about to launch the query.
 *
 * Outside the eval harness the read boundary of mail digests, the envelope key
 * and the per-role native copies rests on the authority mask and the SDK sandbox
 * (R3 to R5 are best-effort so that eval runs on a host without them still work).
 * `hostPreflight` turns that best-effort into a refusal for any org that is not an
 * eval org; for an eval org the gaps are warnings, since the harness probes its
 * own fixture. A runtime without a copy-inventory entry is refused the same way.
 */
import { authorityMaskAvailability } from '../authority-mask.js';
import { sandboxAvailability } from '../role-sandbox-restrictions.js';
import type { OrgDef } from '../types.js';
import { copyInventoryFindings } from './copy-inventory.js';
import { sectionsSurface } from './surface.js';

interface Availability {
  available: boolean;
  reason?: string;
}

export interface HostProbes {
  mask?: Availability;
  sandbox?: Availability;
}

export interface PreflightResult {
  ok: boolean;
  refusals: string[];
  warnings: string[];
}

let override: HostProbes | undefined;

/** Test seam: replaces the host probes until called again with undefined. */
export function setHostProbes(p: HostProbes | undefined): void {
  override = p;
}

/** The probes of this host, unless a test replaced them. */
function probes(given?: HostProbes): { mask: Availability; sandbox: Availability } {
  const p = given ?? override;
  return {
    mask: p?.mask ?? authorityMaskAvailability(),
    sandbox: p?.sandbox ?? sandboxAvailability(),
  };
}

export function hostPreflight(def: OrgDef, given?: HostProbes): PreflightResult {
  if (!sectionsSurface(def).enabled) return { ok: true, refusals: [], warnings: [] };
  const evalMode =
    (def.run_config as { experimental?: string } | undefined)?.experimental === 'eval';
  const gaps: string[] = [];
  const p = probes(given);
  if (!p.mask.available)
    gaps.push(
      `the authority mask (bubblewrap) is unavailable on this host (${p.mask.reason ?? 'unknown'}), so mail digests, the envelope key and native runner copies are protected by file-tool rules alone`,
    );
  if (!p.sandbox.available)
    gaps.push(
      `the SDK sandbox is unavailable on this host (${p.sandbox.reason ?? 'unknown'}), so shell commands run without the read and write denials`,
    );
  const refusals = evalMode ? [] : [...gaps, ...copyInventoryFindings(def).errors];
  return { ok: refusals.length === 0, refusals, warnings: evalMode ? gaps : [] };
}

/** Throws when `hostPreflight` refuses; `what` names the action ("start", "replace role x"). */
export function assertHostPreflight(def: OrgDef, org: string, what: string): void {
  const r = hostPreflight(def);
  if (!r.ok) throw new Error(`org "${org}" cannot ${what} on this host: ${r.refusals.join('; ')}`);
}
