// packages/@monomind/cli/src/orgrt/role-run-spec.ts
/**
 * What a role will run on, resolved the way session-run.ts resolves it: the
 * model (explicit pin > cost tier > runtime or vendor default), the effort (the
 * tier's, else the runtime's default unless the role is exempt) and the runtime.
 * For the dry run and the cost estimate, which otherwise showed a model only for
 * a role that pins one. A named provider's own default model is not known here,
 * as in the estimate before this.
 */
import {
  defaultRoleEffort,
  isRoleExempt,
  type OrgEffortLevel,
  resolveRoleCostTier,
} from './cost-tier.js';
import { effectiveRoleRuntime } from './runner-resolve.js';
import { resolveModel } from './session-prompt.js';
import type { OrgDef, OrgRole } from './types.js';

export interface RoleRunSpec {
  runtime: string;
  model: string;
  effort: OrgEffortLevel | undefined;
}

export function roleRunSpec(def: OrgDef, role: OrgRole): RoleRunSpec {
  const runtime = effectiveRoleRuntime(role.runtime, def.runtime, role.provider?.kind);
  const tier = resolveRoleCostTier({ role, def, vendor: role.provider?.vendor });
  const model =
    role.adapter_config?.model ??
    tier?.model ??
    resolveModel(role, role.runtime ?? def.runtime, role.provider?.vendor);
  const effort =
    tier?.effort ?? (isRoleExempt(def, role.id) ? undefined : defaultRoleEffort(runtime));
  return { runtime, model, effort };
}
