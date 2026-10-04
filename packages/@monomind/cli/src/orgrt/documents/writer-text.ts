// packages/@monomind/cli/src/orgrt/documents/writer-text.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.2): the typed codes and the texts of the writer core.
 * Definition-time findings name the path they are about and a remedy (as `definition.ts` does); the
 * runtime refusals are written for a role that just tried to write and must know what to do next.
 */

export type WriterCode =
  | 'writes-second-section'
  | 'writer-worktree-per-role'
  | 'writer-multiple'
  | 'writer-none'
  | 'writer-scope-uncovered'
  | 'writer-readonly-grant'
  | 'writer-readonly-git'
  | 'writer-sandbox-mode-overridden'
  | 'writer-boundary-unqualified';

export interface WriterFinding {
  code: WriterCode;
  severity: 'error' | 'warning';
  /** The definition path the finding is about, e.g. `roles.qa.policy.sandbox.allowWrite`. */
  path: string;
  /** Names the path and a remedy. */
  message: string;
  /** Roles the finding is about, in definition order. */
  roles: string[];
}

/** One way a role can change the shared workspace. */
export type MutationReason =
  | { kind: 'file-tools'; tools: string[]; scope: string[] }
  | { kind: 'shell'; causes: string[] }
  | { kind: 'provider'; providers: string[] }
  | { kind: 'unclassified-tool'; tools: string[] }
  | { kind: 'runner'; runtime: string };

export function describeReason(r: MutationReason): string {
  switch (r.kind) {
    case 'file-tools':
      return `file tools ${r.tools.join(', ')} with fileWrite ${r.scope.join(', ')}`;
    case 'shell':
      return `Bash that is not behind a qualified read-only boundary (${r.causes.join('; ')})`;
    case 'provider':
      return `tool provider ${r.providers.join(', ')} (its tools are not classified read-only)`;
    case 'unclassified-tool':
      return `tool ${r.tools.join(', ')} (effect unknown, which counts as writing)`;
    case 'runner':
      return `the "${r.runtime}" runner (its file and shell effects cannot be classified here)`;
  }
}

export const READ_ONLY_REMEDY =
  'make the others read-only: deny Write, Edit, MultiEdit and NotebookEdit (policy.denyTools) and set policy.sandbox.mode "required" with policy.sandbox.denyWrite naming the workspace';

export function secondWriterSectionText(sections: string[]): string {
  return `sections.${sections.join(', sections.')}: more than one section declares writes (single writer per workspace) — keep writes on the one section whose role changes the repository and hand the rest off as documents, or run the sections in separate org workspaces`;
}

export function worktreePerRoleText(): string {
  return 'run_config.workspace: "worktree-per-role" cannot be combined with sections.<s>.writes — separate trees mean separate writers (not yet supported), and a failed worktree silently shares the project directory; use "repo", "isolated" or a path';
}

export function multipleWritersText(
  workspace: string,
  writers: { role: string; reasons: MutationReason[] }[],
): string {
  const list = writers
    .map((w) => `${w.role} (${w.reasons.map(describeReason).join('; ')})`)
    .join('; ');
  return `workspace ${workspace}: ${writers.length} roles can change it, at most one may — ${list}. Keep write authority on one role and ${READ_ONLY_REMEDY}, or use separate org workspaces`;
}

export function noWriterText(section: string): string {
  return `sections.${section}.writes: no role can write the workspace, so the declared paths are unreachable — give one role of the section file-write authority or remove writes`;
}

export function uncoveredScopeText(role: string, entries: string[], writes: string[]): string {
  return `roles.${role}.policy.fileWrite: ${entries.join(', ')} not covered by the section's writes (${writes.join(', ')}) — narrow the entry to a path inside writes, or remove it (the role then gets writes itself)`;
}

export function readOnlyGrantText(role: string, key: string, entries: string[]): string {
  return `roles.${role}.policy.${key}: ${entries.join(', ')} would let a read-only role change the shared workspace — remove it (only the writing section's role may write the workspace)`;
}

export function readOnlyGitText(role: string, level: string): string {
  return `roles.${role}.policy.git: "${level}" lets a read-only role change the repository — set "read" or remove it (only the writing section's role may write the workspace)`;
}

export function sandboxModeText(role: string, mode: string): string {
  return `roles.${role}.policy.sandbox.mode: "${mode}" is replaced by "required" for a read-only role — set "required" or remove it`;
}

export function boundaryUnqualifiedText(role: string, workspace: string, why: string): string {
  return `roles.${role}: the read-only boundary for ${workspace} is not qualified (${why}) — the role's start is held rather than widened; free the workspace of runtime-created entries or lock it as a whole`;
}

/** What a role sees when its write is refused. `writer` is the sole writing role when known. */
export function refusalText(
  kind: 'outside-writes' | 'read-only',
  role: string,
  path: string,
  detail: { section?: string; writes: string[]; writer?: string },
): string {
  if (kind === 'outside-writes')
    return `REFUSED: ${role} (section ${detail.section ?? '?'}) may write only inside its section's writes (${detail.writes.join(', ')}); ${path} is outside them. Write inside those paths, or hand the change to the role that owns ${path} as a document (org_doc_publish).`;
  const owner = detail.writer
    ? `${detail.writer} is the only role that may write the workspace`
    : 'one role of the org may write the workspace and it is not you';
  return `REFUSED: ${role} cannot change ${path}: this org has a single writer for the workspace (writes ${detail.writes.join(', ')}) and ${owner}. Hand the change over as a document (org_doc_publish), or through your lead or the root; the writer applies it.`;
}
