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
 * own fixture. A runtime without a copy-inventory entry, or whose entry is
 * `refused`, is refused the same way; one whose entry is `unverified` runs with
 * a warning (runtime-isolation.ts).
 *
 * #768: `run_config.host_isolation: "best-effort"` is the operator's opt-in for a
 * host that cannot provide the mask or the sandbox. The mask and sandbox gaps
 * become warnings, as in eval mode; copy-inventory refusals stay refusals.
 */
import { authorityMaskAvailability } from '../authority-mask.js';
import { sandboxAvailability } from '../role-sandbox-restrictions.js';
import { effectiveRoleRuntime } from '../runner-specs.js';
import type { OrgDef } from '../types.js';
import { copyInventoryFindings } from './copy-inventory.js';
import { runtimeIsolation } from './runtime-isolation.js';
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

const maskName = (platform: NodeJS.Platform): string =>
  platform === 'darwin' ? 'Seatbelt' : platform === 'win32' ? 'none on Windows' : 'bubblewrap';

/** What to do on this platform when the mask cannot run. */
const maskFix = (platform: NodeJS.Platform): string =>
  platform === 'darwin'
    ? 'Start the org from a terminal that is not itself inside a sandbox (Seatbelt does not nest) and check that /usr/bin/sandbox-exec exists.'
    : platform === 'win32'
      ? 'Run the org under WSL2 (Linux), where bubblewrap can be installed.'
      : 'Install bubblewrap (bwrap) and allow unprivileged user namespaces.';

/** The runtimes of `def` whose native copies only a bind mount can separate (`mask-bind`). */
function bindOnlyRuntimes(def: OrgDef): string[] {
  const out = new Set<string>();
  for (const role of def.roles) {
    if ((role as { kind?: string }).kind === 'endpoint') continue;
    const runtime = effectiveRoleRuntime(role.runtime, def.runtime, role.provider?.kind);
    if (runtimeIsolation(runtime)?.strategy === 'mask-bind') out.add(runtime);
  }
  return [...out];
}

export function hostPreflight(
  def: OrgDef,
  given?: HostProbes,
  platform: NodeJS.Platform = process.platform,
): PreflightResult {
  if (!sectionsSurface(def).enabled) return { ok: true, refusals: [], warnings: [] };
  const evalMode =
    (def.run_config as { experimental?: string } | undefined)?.experimental === 'eval';
  const gaps: string[] = [];
  const p = probes(given);
  if (!p.mask.available)
    gaps.push(
      `the authority mask (${maskName(platform)}) is unavailable on this host (${p.mask.reason ?? 'unknown'}), so mail digests, the envelope key and native runner copies are protected by file-tool rules alone. ${maskFix(platform)}`,
    );
  if (!p.sandbox.available)
    gaps.push(
      `the SDK sandbox is unavailable on this host (${p.sandbox.reason ?? 'unknown'}), so shell commands run without the read and write denials`,
    );
  const unbound = platform === 'darwin' && p.mask.available ? bindOnlyRuntimes(def) : [];
  const macNote = unbound.length
    ? [
        `on macOS the Seatbelt mask cannot give each role a private native runner copy directory for the ${unbound.join(', ')} runtime (it has no bind mounts and the CLI cannot be pointed at another directory), so those transcripts are shared between its roles`,
      ]
    : [];
  const bestEffort =
    (def.run_config as { host_isolation?: string } | undefined)?.host_isolation === 'best-effort';
  const inventory = copyInventoryFindings(def);
  const strictGaps = evalMode || bestEffort ? [] : gaps;
  const refusals = evalMode
    ? []
    : [...strictGaps, ...inventory.errors, ...(strictGaps.length ? [OPT_IN_HINT] : [])];
  const hostWarnings = evalMode
    ? gaps
    : bestEffort
      ? gaps.map((g) => `run_config.host_isolation is "best-effort": ${g}`)
      : [];
  return {
    ok: refusals.length === 0,
    refusals,
    warnings: [...hostWarnings, ...macNote, ...inventory.warnings],
  };
}

/** The last line of a refusal that includes a host gap: the opt-in that lets it start. */
const OPT_IN_HINT =
  'if this host cannot provide them, set run_config.host_isolation to "best-effort" in the org definition (and sign it again) to start with these protected by file-tool rules alone';

/** Throws when `hostPreflight` refuses; `what` names the action ("start", "replace role x").
 *  Returns the warnings of a start it lets through. */
export function assertHostPreflight(def: OrgDef, org: string, what: string): string[] {
  const r = hostPreflight(def);
  if (!r.ok) throw new Error(`org "${org}" cannot ${what} on this host: ${r.refusals.join('; ')}`);
  return r.warnings;
}
