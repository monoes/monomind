/**
 * Whether bubblewrap runs here (#798). The eval kits give every role
 * `policy.sandbox.denyExec` (the no-node layer), and only the bubblewrap mask
 * can apply it: on macOS the authority mask is a Seatbelt profile (#768), which
 * has no bind mounts, so roleExecMask (orgrt/exec-deny.ts) refuses such a role
 * and none starts. authorityMaskAvailability() is true there, so a test gated
 * on it runs and fails; gate on this instead. Warns when bubblewrap is missing
 * so the skip shows in the run output.
 */
import { bubblewrapAvailability } from '../orgrt/authority-mask.js';

export function bubblewrapRuns(suite: string): boolean {
  const a = bubblewrapAvailability();
  if (a.available) return true;
  console.warn(`${suite}: skipped, the roles' denyExec layer needs bubblewrap (${a.reason}, #798)`);
  return false;
}
