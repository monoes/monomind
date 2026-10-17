// packages/@monomind/cli/src/orgrt/org-model-guard.ts
/**
 * Every model an org definition could end up running, checked against the
 * model guard (src/model-guard.ts): each role's `adapter_config.model`, every
 * `cost_tiers` entry for any provider key, and what a role with no model of
 * its own resolves to. Errors, not warnings: a blocked model is never routed.
 */
import { outdatedModelHint } from '../latest-models.js';
import { isBlockedModel } from '../model-guard.js';
import { resolveModel } from './session-prompt.js';
import type { OrgDef } from './types.js';

/** One error per place in `def` that names or resolves to a blocked model. */
export function validateOrgModels(def: OrgDef): string[] {
  const errors: string[] = [];
  const blocked = (model: unknown, where: string): void => {
    if (isBlockedModel(model)) {
      errors.push(
        `${where} names the blocked model "${String(model)}": Claude Fable and GPT Astra models are never assigned or routed — use another model`,
      );
    }
  };
  for (const role of def.roles) {
    const where = `role "${role.id}"`;
    blocked(role.adapter_config?.model, `${where} adapter_config.model`);
    if (!role.adapter_config?.model) {
      try {
        resolveModel(role, role.runtime ?? def.runtime, role.provider?.vendor);
      } catch (e) {
        errors.push(`${where} would run a blocked default model: ${(e as Error).message}`);
      }
    }
  }
  for (const [tier, providers] of Object.entries(def.cost_tiers?.tiers ?? {})) {
    for (const [provider, entry] of Object.entries(providers)) {
      blocked(entry.model, `cost_tiers.tiers.${tier}.${provider}`);
    }
  }
  return errors;
}

/** One warning per pinned model that is older than the newest of its family
 *  (latest-models.ts), naming the model to use instead. */
export function outdatedModelWarnings(def: OrgDef): string[] {
  const warnings: string[] = [];
  const check = (model: unknown, where: string): void => {
    const newest = typeof model === 'string' ? outdatedModelHint(model) : undefined;
    if (newest) {
      warnings.push(
        `${where} pins ${String(model)}, an older model; the newest in its family is ${newest} — update the pin, or remove it to use the default`,
      );
    }
  };
  for (const role of def.roles) check(role.adapter_config?.model, `role "${role.id}"`);
  for (const [tier, providers] of Object.entries(def.cost_tiers?.tiers ?? {})) {
    for (const [provider, entry] of Object.entries(providers)) {
      check(entry.model, `cost_tiers.tiers.${tier}.${provider}`);
    }
  }
  return warnings;
}
