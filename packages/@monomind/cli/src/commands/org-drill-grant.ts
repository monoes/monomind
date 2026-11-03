// packages/@monomind/cli/src/commands/org-drill-grant.ts
//
// `monomind org drill-grant` (#720): the operator, in their own terminal,
// lets named roles of a named org (release QA) sign throwaway drill orgs for a
// limited time, without turning on `org.allowDrillSigning` for everyone. It
// writes ~/.monomind/operator-settings.json, which roles cannot write, and
// refuses to run from a role or agent process.
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DRILL_GRANT_MAX_MS,
  OPERATOR_SETTINGS_FILE,
  trustedHome,
} from '../orgrt/operator-settings.js';
import { roleContextMarker } from '../orgrt/org-signature.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

const fail = (message: string, exitCode = 2): CommandResult => {
  console.log(output.error(message));
  return { success: false, message, exitCode };
};

const csv = (v: unknown): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const drillGrantAction = async (input: CommandContext): Promise<CommandResult> => {
  const marker = roleContextMarker();
  if (marker || process.env.CLAUDECODE || process.env.AI_AGENT || process.env.AGENT)
    return fail(
      `Refusing: ${marker ?? 'an agent session'} is set. Only the operator grants drill signing; run this yourself in a terminal.`,
      1,
    );
  const home = trustedHome();
  if (!home) return fail('org drill-grant: cannot find the home directory', 1);
  let value: unknown = false;
  let summary = 'revoked';
  if (input.flags.revoke !== true) {
    const orgs = csv(input.flags.org);
    const roles = csv(input.flags.role);
    const ttl = Number(input.flags.ttl);
    if (!orgs.length || !roles.length || orgs.includes('*') || roles.includes('*'))
      return fail(
        'org drill-grant: name the org(s) with --org and the role(s) with --role (no "*")',
      );
    if (!Number.isFinite(ttl) || ttl <= 0 || ttl * 60_000 > DRILL_GRANT_MAX_MS)
      return fail('org drill-grant: --ttl is minutes, from 1 to 1440 (24 hours)');
    const now = Date.now();
    value = {
      orgs,
      roles,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 60_000).toISOString(),
    };
    summary = `granted to role(s) ${roles.join(', ')} of org(s) ${orgs.join(', ')} for ${ttl} minute(s)`;
  }
  const dir = join(home, '.monomind');
  const file = join(dir, OPERATOR_SETTINGS_FILE);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ org: { allowDrillSigning: value } }, null, 2)}\n`, {
    mode: 0o600,
  });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  console.log(output.success(`Drill signing ${summary} (${file}).`));
  return { success: true, message: `drill signing ${summary}` };
};

export const drillGrantSubcommand: Command = {
  name: 'drill-grant',
  description:
    'Operator only: let named roles of a named org sign throwaway QA-drill orgs for a limited time (#720)',
  options: [
    { name: 'org', description: 'Org name(s), comma separated (e.g. release)', type: 'string' },
    { name: 'role', description: 'Role id(s), comma separated (e.g. runtime-qa)', type: 'string' },
    { name: 'ttl', description: 'Minutes the grant lasts (1 to 1440)', type: 'string' },
    { name: 'revoke', description: 'Turn drill signing off again', type: 'boolean' },
  ],
  examples: [
    {
      command: 'monomind org drill-grant --org release --role runtime-qa --ttl 120',
      description: "Let the release org's runtime-qa role sign drill orgs for two hours",
    },
  ],
  action: drillGrantAction,
};
