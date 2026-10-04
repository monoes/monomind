// packages/@monomind/cli/src/orgrt/documents/writer-view.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.4): the definition as the writer core reads it. The core
 * classifies a role's runner from `role.runtime ?? def.runtime`; the runtime also resolves `provider.kind` and
 * the `MONOMIND_RUNTIME` default (`effectiveRoleRuntime`), so the view names each role's effective runner
 * and the core never has to know the resolution order. Everything else is passed through untouched.
 */
import { effectiveRoleRuntime } from '../runner-specs.js';
import type { OrgDef } from '../types.js';
import type { WriterDef, WriterRole } from './writer-overlay.js';

export function writerView(def: OrgDef): WriterDef {
  const raw = def as unknown as WriterDef;
  return {
    ...raw,
    roles: def.roles.map(
      (r) =>
        ({
          ...r,
          runtime: effectiveRoleRuntime(
            r.runtime,
            (def as { runtime?: unknown }).runtime,
            r.provider?.kind,
          ),
        }) as unknown as WriterRole,
    ),
  };
}
