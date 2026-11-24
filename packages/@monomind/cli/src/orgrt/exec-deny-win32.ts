// packages/@monomind/cli/src/orgrt/exec-deny-win32.ts
/**
 * roleExecMask for the native-Windows mask (#852): other roles' mail digests
 * and anything in `policy.sandbox.denyRead` become unreadable to this role
 * (a deny entry for its own marker SID), the mail root read-only with the
 * role's own directory writable. Needs no bind mounts, so Claude's native
 * directories cannot be made private (audited `native-copies-unprotected`),
 * and `denyExec` / `homeWriteAllow` (which need them) refuse the role.
 */
import { existsSync, realpathSync } from 'node:fs';
import {
  allowModifyRule,
  denyAllRule,
  denyWriteRule,
  roleMarker,
  winMaskWith,
} from './authority-mask-win32.js';
import type { OrgBus } from './bus.js';

const real = (p: string): string | undefined => {
  try {
    return existsSync(p) ? realpathSync.native(p) : undefined;
  } catch {
    return undefined;
  }
};

export function winExecMask(args: {
  bus: OrgBus;
  roleId: string;
  authorityMask: string[] | undefined;
  denyExec?: string[];
  denyRead?: string[];
  bestEffortDenyRead?: string[];
  bestEffortReadOnly?: string[];
  bestEffortBinds?: { src: string; dest: string }[];
  homeWriteAllow?: string[];
}): string[] | undefined {
  const audit = (reason: string, msg: string) =>
    args.bus.emit({ type: 'audit', from: args.roleId, reason, msg, data: {} });
  const asked = args.denyExec?.length
    ? 'denyExec'
    : args.homeWriteAllow !== undefined
      ? 'homeWriteAllow'
      : undefined;
  if (asked) {
    const msg = `policy.sandbox.${asked} is set for role ${args.roleId} but the native Windows mask cannot do it (it has no bind mounts): refusing to start it with the program or home reachable; run the org on Linux or under WSL2`;
    audit('deny-exec-unavailable', msg);
    throw new Error(msg);
  }
  const sid = roleMarker(args.roleId);
  const binds = args.bestEffortBinds ?? [];
  if (binds.some((b) => b.src !== b.dest))
    audit(
      'native-copies-unprotected',
      `the native Windows mask cannot give ${args.roleId} private runner copy directories; its native transcripts are shared with the other roles`,
    );
  const rules = [
    ...(args.bestEffortReadOnly ?? []).flatMap((d) =>
      real(d) ? [denyWriteRule(real(d)!, sid)] : [],
    ),
    ...[...(args.denyRead ?? []), ...(args.bestEffortDenyRead ?? [])].flatMap((d) =>
      real(d) ? [denyAllRule(real(d)!, sid)] : [],
    ),
    ...binds
      .filter((b) => b.src === b.dest)
      .flatMap((b) => (real(b.dest) ? [allowModifyRule(real(b.dest)!, sid)] : [])),
  ];
  if (!args.authorityMask) {
    if (rules.length)
      audit(
        'mail-mask-unavailable',
        `no restricted-token layer can mask other roles' mail digests for ${args.roleId}; the file-tool and SDK-sandbox denials still apply`,
      );
    return undefined;
  }
  return winMaskWith(args.authorityMask, args.roleId, rules);
}
