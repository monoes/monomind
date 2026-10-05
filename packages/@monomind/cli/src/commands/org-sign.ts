// packages/@monomind/cli/src/commands/org-sign.ts
//
// `monomind org sign <org> | --all` (#502): the operator reviews an org
// definition's authority (roles, runtimes, git levels, access, schedule,
// prechecks) and signs it. The runtime refuses to start or reload a
// definition whose signature does not verify (orgrt/org-signature.ts).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOperatorDir } from '../orgrt/broker.js';
import {
  operatorDirBlockedReason,
  operatorDirProtectedMessage,
} from '../orgrt/operator-dir-guard.js';
import {
  instructionsDigests,
  orgHashMismatchMessage,
  orgSignatureEnforced,
  roleContextMarker,
  signOrgDef,
  verifyOrgDef,
} from '../orgrt/org-signature.js';
import { ORG_DIR } from '../orgrt/types.js';
import { output } from '../output.js';
import { commandParser } from '../parser.js';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { listOrgConfigFiles, validateOrgName } from './org-control.js';
import { checkAction, parseExpectHashes, resolveSignRoot } from './org-sign-check.js';
import {
  type LoadedOrg,
  loadOrg,
  printReview,
  readRaw,
  reviewJsonAction,
} from './org-sign-show.js';

const log = (text: string): void => {
  console.log(text);
};

/** Sign one loaded org. Returns an error string, or undefined on success. */
async function signOne(
  ctx: CommandContext,
  org: LoadedOrg,
  confirmEach: boolean,
  expectHash: string | undefined,
): Promise<string | undefined> {
  const { name, raw, digests } = org;
  printReview(ctx.cwd, name, raw, digests);
  if (confirmEach) {
    const { confirm } = await import('../prompt.js');
    const ok = await confirm({ message: `Sign org "${name}" as the operator?`, default: false });
    if (!ok) return `org ${name}: not signed (declined)`;
  }
  let at: string;
  try {
    ({ at } = signOrgDef(ctx.cwd, name, raw, { digests, expectHash }));
  } catch (err) {
    return (err as Error).message;
  }
  log(output.success(`org ${name}: signed (${at})`));
  return undefined;
}

const kebab = (key: string): string => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const camel = (key: string): string => key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `org sign` fails closed on a flag it does not know: an older build
 *  silently ignored `--expect-hash` and signed anyway. The CLI parser allows
 *  unknown flags globally, so this command checks its own. */
function unknownSignFlags(flags: CommandContext['flags']): string[] {
  const known = new Set<string>(['_']);
  for (const opt of [...commandParser.getGlobalOptions(), ...(signSubcommand.options ?? [])]) {
    known.add(opt.name);
    known.add(camel(opt.name));
  }
  const unknown = new Set<string>();
  for (const key of Object.keys(flags)) if (!known.has(key)) unknown.add(`--${kebab(key)}`);
  return [...unknown];
}

export const signAction = async (input: CommandContext): Promise<CommandResult> => {
  const unknown = unknownSignFlags(input.flags);
  if (unknown.length) {
    const message =
      `org sign: unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} — nothing signed. ` +
      'See `monomind org sign --help`.';
    log(output.error(message));
    return { success: false, message, exitCode: 2 };
  }
  // Read-only (#558): runs anywhere, including inside a role.
  if (input.flags.check === true) return checkAction(input);
  // A role's own process tree must never sign — it would approve its own
  // changes. A human's own coding-agent session (the createorg skill) is the
  // operator and may; the key's location is the real barrier for roles.
  const marker = roleContextMarker();
  if (marker) {
    log(
      output.error(
        `Refusing: ${marker} is set — this is an org role or agent-exec process. ` +
          'Only the operator signs org definitions; run this yourself in a terminal.',
      ),
    );
    return { success: false, message: `refused: role context (${marker})` };
  }
  // #643: a role's sandbox hides the operator dir on purpose; refuse before
  // anything is written (an empty tmpfs there would swallow the write).
  const dir = defaultOperatorDir();
  const blocked = operatorDirBlockedReason(dir);
  if (blocked) {
    const message = `org sign: ${operatorDirProtectedMessage(dir, blocked)}`;
    log(output.error(message));
    return { success: false, message, exitCode: 1 };
  }
  const where = resolveSignRoot(input);
  if ('error' in where) return { success: false, message: where.error, exitCode: 2 };
  const ctx: CommandContext = { ...input, cwd: where.root };
  const all = ctx.flags.all === true;
  let names: string[];
  if (all) {
    const dir = join(ctx.cwd, ORG_DIR);
    names = existsSync(dir) ? listOrgConfigFiles(dir).map((f) => f.replace(/\.json$/, '')) : [];
    if (!names.length) {
      log(output.info('No org definitions to sign.'));
      return { success: true, message: 'nothing to sign' };
    }
  } else {
    const validated = validateOrgName(ctx.args[0]);
    if (!validated.ok) return validated.result;
    names = [validated.name];
  }
  const expect = parseExpectHashes(ctx, names);
  if ('error' in expect) {
    log(output.error(expect.error));
    return { success: false, message: expect.error, exitCode: 2 };
  }
  const yes = ctx.flags.yes === true;
  if (!yes && ctx.flags.format === 'json') return reviewJsonAction(ctx, names);
  if (!ctx.interactive && !yes) {
    // Show what would be signed (the createorg skill relies on this), sign nothing.
    for (const name of names) {
      try {
        printReview(ctx.cwd, name, readRaw(ctx.cwd, name));
      } catch (err) {
        log(output.error(`org ${name}: ${(err as Error).message}`));
      }
    }
    log(
      output.error(
        'Not signed. Review the above, then sign it yourself in a terminal: monomind org sign <org> (or pass --yes).',
      ),
    );
    return { success: false, message: 'confirmation required (--yes)' };
  }
  const loaded = names.map((name) => loadOrg(ctx.cwd, name));
  if (expect.hashes) {
    // Compare before signing anything: with --expect-hash, one org that is
    // not as expected signs none.
    const refusals = loaded.map((org) =>
      typeof org === 'string'
        ? org
        : org.hash === expect.hashes?.get(org.name)
          ? undefined
          : orgHashMismatchMessage(org.name, expect.hashes?.get(org.name) ?? '', org.hash),
    );
    const failed = refusals.filter((r): r is string => r !== undefined);
    if (failed.length) {
      for (const r of failed) log(output.error(r));
      return { success: false, message: failed.join('; '), exitCode: 1 };
    }
  }
  const errors: string[] = [];
  for (const org of loaded) {
    const err =
      typeof org === 'string'
        ? org
        : await signOne(ctx, org, ctx.interactive && !yes, expect.hashes?.get(org.name));
    if (err) {
      errors.push(err);
      log(output.error(err));
    }
  }
  if (errors.length) return { success: false, message: errors.join('; '), exitCode: 1 };
  log(output.info('Running orgs pick up a signed change with `monomind org reload <org>`.'));
  return { success: true, message: `signed ${names.length} org(s)` };
};

/** `org run`'s gate (#502 migration). A verified definition passes. An
 *  UNSIGNED one (every org made before signing existed) run from a human's
 *  terminal gets a one-time review-and-sign prompt; every other case —
 *  a changed or forged signature, or no TTY — is refused with the
 *  `org sign` hint. Returns a CommandResult to end `org run` with, or
 *  undefined to go on. */
export async function ensureOrgSignedForRun(
  ctx: CommandContext,
  name: string,
): Promise<CommandResult | undefined> {
  if (!orgSignatureEnforced()) return undefined;
  let raw: unknown;
  try {
    raw = readRaw(ctx.cwd, name);
  } catch {
    return undefined; // unreadable: let the start path report the real error
  }
  // One read of each instructions file: what is reviewed is what is signed.
  const digests = instructionsDigests(raw, ctx.cwd);
  const check = verifyOrgDef(ctx.cwd, name, raw, { digests });
  if (check.ok) return undefined;
  if (check.reason === 'unsigned' && ctx.interactive && !roleContextMarker()) {
    log(
      output.warning(
        `org ${name} has no operator signature yet (orgs are signed since #502). Review what it may do:`,
      ),
    );
    printReview(ctx.cwd, name, raw, digests);
    const { confirm } = await import('../prompt.js');
    const ok = await confirm({
      message: `Sign org "${name}" as the operator and run it?`,
      default: false,
    });
    if (ok) {
      signOrgDef(ctx.cwd, name, raw, { digests });
      log(output.success(`org ${name}: signed`));
      return undefined;
    }
  }
  log(output.error(check.message));
  // #643: from a role the signature cannot be there, and the dir is hidden on purpose.
  const dir = defaultOperatorDir();
  const hidden = operatorDirBlockedReason(dir) ?? (roleContextMarker() ? 'org role' : undefined);
  if (hidden) log(output.error(operatorDirProtectedMessage(dir, hidden)));
  return { success: false, message: `org ${name} is not signed (${check.reason})`, exitCode: 1 };
}

export const signSubcommand: Command = {
  name: 'sign',
  description: "Review an org definition's authority and sign it as the operator",
  options: [
    { name: 'all', description: 'Sign every org definition in the project', type: 'boolean' },
    {
      name: 'yes',
      short: 'y',
      description: 'Skip the per-org confirmation (required when not on a TTY)',
      type: 'boolean',
    },
    {
      name: 'check',
      description:
        'Only report whether each org verifies (signed, changed, unsigned, …); never prompts, signs or writes. Exit 0 all signed, 1 otherwise, 2 not found or usage error. With --format json: {"orgs":[…]}',
      type: 'boolean',
    },
    {
      name: 'project',
      description:
        'Use <dir> (its real path; must hold .monomind/orgs) as the project root instead of the current directory',
      type: 'string',
    },
    {
      name: 'expect-hash',
      description:
        'Sign only if the hash about to be signed is <hex> (the "hash" of --check --format json); otherwise exit 1 and write nothing. With --all, repeat as <org>=<hex> for every org',
      type: 'array',
    },
  ],
  examples: [
    { command: 'monomind org sign growth', description: 'Review and sign one org' },
    { command: 'monomind org sign --all', description: 'Sign every org (migration)' },
    {
      command: 'monomind org sign growth --check --format json --project ~/work/app',
      description: 'Machine-readable signature state, without signing',
    },
  ],
  action: signAction,
};
