/**
 * Monomind Mesh presence for one org role session (tier org-role): the role shows up in
 * `mesh_who` for the length of its session, as a child of the Claude session that started the
 * run when there is one. Best effort and off with MONOMIND_MESH_AUTOJOIN=0: the promise never
 * rejects and a down hub only costs the (bounded) join attempt, which overlaps session setup.
 */

import { meshDir } from '../mesh/hub.js';
import {
  joinManaged,
  type ManagedPresence,
  meshAutojoinEnabled,
  roleNote,
} from '../mesh/managed-presence.js';
import { findAncestorSessionAddr } from '../mesh/session-files.js';

export interface RoleMeshInput {
  org: string;
  roleId: string;
  runtime: string;
  /** Project root of the org (not the role's scratch workspace). */
  cwd: string;
}

export interface RoleMesh {
  presence: ManagedPresence;
  /** Appended to the role's system prompt. */
  note: string;
}

const clean = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '-');

export async function joinRoleMesh(
  o: RoleMeshInput,
  join: typeof joinManaged = joinManaged,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RoleMesh | undefined> {
  // Tests exercise sessions by the hundred: they only reach a hub through an injected `join`.
  if (!meshAutojoinEnabled(env) || (join === joinManaged && env.VITEST)) return undefined;
  try {
    const parent = findAncestorSessionAddr(meshDir());
    const presence = await join({
      tier: 'org-role',
      runtime: o.runtime,
      cwd: o.cwd,
      alias: `${clean(o.org)}-${clean(o.roleId)}`.slice(0, 60),
      agentId: o.roleId,
      task: `org ${o.org}, role ${o.roleId}`,
      timeoutMs: 1500,
      ...(parent ? { parent } : {}),
    });
    return presence && { presence, note: roleNote(presence.alias, await presence.unreadBlock()) };
  } catch {
    return undefined;
  }
}
