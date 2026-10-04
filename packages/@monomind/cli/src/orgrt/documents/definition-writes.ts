// packages/@monomind/cli/src/orgrt/documents/definition-writes.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.4): the single-writer findings of a definition on the sections
 * surface, from the P4.2 core (`writerPreflight`). Called once from `definition.ts`. Without a section that
 * declares non-empty `writes` the core returns nothing, so an org that does not use the key is unaffected.
 *
 * The "more than one section declares writes" error keeps the text `definition.ts` always had, so the core's
 * own finding for it is not repeated here. Findings carry the core's severity: conflicts with the single-writer
 * rule (two roles that can change the workspace, a read-only role's own write grant, git above "read" on a
 * read-only role, `worktree-per-role`) are errors; an unreachable `writes` and a sandbox mode the overlay
 * replaces are warnings. The org root is not known here, so a relative sandbox entry is compared with the
 * workspace only where both are relative (the boundary check at role start is the backstop).
 */
import type { OrgDef } from '../types.js';
import type { Findings } from './definition-util.js';
import { writerPreflight } from './writer-policy.js';
import { writerView } from './writer-view.js';

export function writerDefinitionFindings(def: OrgDef, f: Findings): void {
  for (const finding of writerPreflight(writerView(def)).findings) {
    if (finding.code === 'writes-second-section') continue;
    (finding.severity === 'error' ? f.errors : f.warnings).push(finding.message);
  }
}
