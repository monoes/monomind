// packages/@monomind/cli/src/commands/org-observe-config.ts
//
// `monomind org validate | create` — org config validation and template
// scaffolding.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveOrgDefBlueprints } from '../catalog/blueprints.js';
import { fullAccessTaintFindings } from '../orgrt/access-taint.js';
import { accessValidationFindings } from '../orgrt/access-validate.js';
import { checkOrgStructure } from '../orgrt/migrate.js';
import { gitEnforcementFindings } from '../orgrt/role-sandbox.js';
import { checklistFindings } from '../orgrt/validate-checklist.js';
import { resolveModel } from '../orgrt/session.js';
import { buildFromTemplate, ORG_TEMPLATES } from '../orgrt/templates.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import { output } from '../output.js';
import type { CommandContext, CommandResult } from '../types.js';
import { listOrgConfigFiles, validateOrgName } from './org-control.js';

const log = (text: string): void => {
  console.log(text);
};

/** Validate org config(s) against OrgDefSchema — the exact parse `org run`/`org serve`
 * perform — plus the structural invariants the runtime assumes but the schema can't
 * express (single root role, resolvable reports_to, unique ids, parseable schedule). */
export const validateAction = async (ctx: CommandContext): Promise<CommandResult> => {
  const orgsDir = join(ctx.cwd || process.cwd(), ORG_DIR);
  let files: string[];
  if (ctx.args[0]) {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    files = [`${validated.name}.json`];
  } else {
    if (!existsSync(orgsDir))
      return {
        success: false,
        message: 'no orgs directory — create an org first with /mastermind:createorg',
      };
    files = listOrgConfigFiles(orgsDir);
    if (!files.length) return { success: false, message: 'no org configs found' };
  }
  let failed = 0;
  for (const f of files) {
    const stem = f.replace(/\.json$/, '');
    const path = join(orgsDir, f);
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!existsSync(path)) {
      log(output.error(`${stem}: not found (${path})`));
      failed++;
      continue;
    }
    try {
      const rawText = readFileSync(path, 'utf8');
      const rawJson = JSON.parse(rawText) as { roles?: { id?: unknown; policy?: unknown }[] };
      const parsedDef = OrgDefSchema.parse(rawJson);
      const bp = resolveOrgDefBlueprints(parsedDef, ctx.cwd || process.cwd());
      const def = bp.def;
      errors.push(...bp.errors);
      for (const n of bp.notes) log(output.info(`${stem}: ${n}`));
      errors.push(...checkOrgStructure(def));
      // #365: policy.access 'full' schema/runtime findings and the taint
      // (untrusted-input reachability) checks for any full-access role.
      const accessFindings = accessValidationFindings(
        def,
        rawJson.roles as { id?: unknown; policy?: Record<string, unknown> }[] | undefined,
      );
      errors.push(...accessFindings.errors);
      warnings.push(...accessFindings.warnings);
      const taintFindings = fullAccessTaintFindings(def);
      errors.push(...taintFindings.errors);
      warnings.push(...taintFindings.warnings);
      // ADR-O001 D8: a cost tier that can't resolve a model for a role's
      // provider is a config error, not a runtime fallback — surface it here
      // as well as at daemon start, so it's caught before a run is attempted.
      const { validateCostTiers } = await import('../orgrt/cost-tier.js');
      errors.push(...validateCostTiers(def));
      // S3: a typo'd placeholder would reach the prompt verbatim.
      const { unknownPromptVarErrors } = await import('../orgrt/prompt-vars.js');
      errors.push(...unknownPromptVarErrors(def));
      // ADR-O001 D7: catalog size (>15 is an error, <5 a warning) and every
      // loadout's skills/file must resolve — same checks as daemon start.
      const { validateLoadouts } = await import('../orgrt/loadouts.js');
      const loadoutFindings = validateLoadouts(def, ctx.cwd || process.cwd());
      errors.push(...loadoutFindings.errors);
      warnings.push(...loadoutFindings.warnings);
      const { validateRoleSkills } = await import('../orgrt/skill-library.js');
      errors.push(...def.roles.flatMap((r) => validateRoleSkills(r, ctx.cwd || process.cwd())));
      // #258: roles whose policy.git won't have the OS sandbox behind it here
      const gitFindings = gitEnforcementFindings(def);
      errors.push(...gitFindings.errors);
      warnings.push(...gitFindings.warnings);
      // #492: directory scope entries, checked as the daemon will see them —
      // after {{org_root}}/{{home}} expansion.
      const { scopeEntryFindings } = await import('../orgrt/policy-scopes.js');
      const { expandOrgPolicyPathVars, promptVarsFor } = await import('../orgrt/prompt-vars.js');
      const scopeFindings = scopeEntryFindings(
        expandOrgPolicyPathVars(def, promptVarsFor(ctx.cwd || process.cwd())).roles,
      );
      errors.push(...scopeFindings.errors);
      warnings.push(...scopeFindings.warnings);
      // Org sections spec 7.3: the shared caveat checklist.
      const checklist = checklistFindings(def);
      errors.push(...checklist.errors);
      warnings.push(...checklist.warnings);
      if (def.name !== stem)
        warnings.push(
          `def.name "${def.name}" differs from filename — the runtime addresses this org as "${stem}"`,
        );
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
    for (const w of warnings) log(output.warning(`${stem}: ${w}`));
    if (errors.length) {
      failed++;
      for (const e of errors) log(output.error(`${stem}: ${e}`));
    } else {
      log(
        output.success(
          `${stem}: valid${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
        ),
      );
    }
  }
  return failed
    ? { success: false, message: `${failed} of ${files.length} org config(s) failed validation` }
    : { success: true, message: `${files.length} org config(s) valid` };
};

/** `org create <name> --template <t> [--goal g] [--schedule s]` — scaffold a config from a template. */
export const createAction = async (ctx: CommandContext, name: string): Promise<CommandResult> => {
  const templateName = typeof ctx.flags.template === 'string' ? ctx.flags.template : '';
  if (!templateName) {
    log(output.info(`Available templates: ${Object.keys(ORG_TEMPLATES).join(', ')}`));
    return {
      success: false,
      message:
        'usage: monomind org create <name> --template <template> [--goal "..."] [--schedule 30m]',
    };
  }
  const def = buildFromTemplate(
    templateName,
    name,
    typeof ctx.flags.goal === 'string' ? ctx.flags.goal : undefined,
  );
  if (!def) {
    log(
      output.error(
        `Unknown template "${templateName}" — available: ${Object.keys(ORG_TEMPLATES).join(', ')}`,
      ),
    );
    return { success: false, message: 'unknown template' };
  }
  if (typeof ctx.flags.schedule === 'string') def.schedule = ctx.flags.schedule;
  const file = join(ctx.cwd, ORG_DIR, `${name}.json`);
  if (existsSync(file) && ctx.flags.force !== true) {
    log(output.error(`Org "${name}" already exists — pass --force to overwrite.`));
    return { success: false, message: 'org exists' };
  }
  OrgDefSchema.parse(def); // templates must always produce a runnable config
  // Org sections spec 7.3: the saved definition gets the same checklist as
  // `org validate`. A template never configures a deferred feature, so an
  // error here is a template bug and nothing is written; advice is shown.
  const checklist = checklistFindings(def);
  for (const e of checklist.errors) log(output.error(`${name}: ${e}`));
  if (checklist.errors.length) return { success: false, message: 'template fails the org checklist' };
  for (const w of checklist.warnings) log(output.warning(`${name}: ${w}`));

  // Per-role model — the single most consequential setting the template picked on
  // the user's behalf. Mirror resolveModel() (same helper `org run`'s cost estimate
  // uses) so a role relying on its runtime/vendor default isn't mislabeled here.
  const modelRows = def.roles.map((r) => {
    const explicit = r.adapter_config?.model;
    return {
      id: r.id,
      model: String(explicit ?? resolveModel(r, r.runtime ?? def.runtime, r.provider?.vendor)),
      explicit: !!explicit,
    };
  });
  const printModels = (): void => {
    log(output.bold('  Models:'));
    for (const r of modelRows) {
      log(`    ${r.id.padEnd(20)} ${r.model}${r.explicit ? '' : '  (default)'}`);
    }
  };

  if (ctx.interactive && ctx.flags.yes !== true) {
    log(
      output.bold(
        `\nAbout to create org "${name}" from template "${templateName}" (${def.roles.length} roles):`,
      ),
    );
    printModels();
    const { confirm } = await import('../prompt.js');
    const proceed = await confirm({ message: 'Create this org?', default: true });
    if (!proceed) {
      log(
        output.info(
          'Cancelled — no file written. Adjust --template/--goal, or edit the template, then retry (pass --yes to skip this prompt).',
        ),
      );
      return { success: false, message: 'cancelled by user' };
    }
  }

  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(ctx.cwd, ORG_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify(def, null, 2)}\n`, 'utf8');
  log(
    output.success(
      `Org "${name}" created from template "${templateName}" (${def.roles.length} roles).`,
    ),
  );
  // #502: the human creating an org is its operator — sign it, from the
  // bytes just written. A role's own process tree never signs.
  const { roleContextMarker, signOrgDef } = await import('../orgrt/org-signature.js');
  if (roleContextMarker()) {
    log(
      output.warning(
        `  Not signed (org role context) — the operator must run: monomind org sign ${name}`,
      ),
    );
  } else {
    signOrgDef(ctx.cwd, name, JSON.parse(readFileSync(file, 'utf8')));
    log(
      output.info(
        `  Signed as the operator. After editing its policy or roles, re-sign: monomind org sign ${name}`,
      ),
    );
  }
  log(
    output.info(
      `  Budget: ${def.run_config.budget_tokens} tokens · Turn limit: ${def.run_config.max_turns_per_message} per message (effectively unlimited by default — set run_config.max_turns_per_message, or a role's own max_turns_per_message, to cap it).`,
    ),
  );
  if (!ctx.interactive || ctx.flags.yes === true) printModels();
  log(output.info(`  Edit the goal/roles in ${file}, then: monomind org run ${name}`));
  return { success: true };
};
