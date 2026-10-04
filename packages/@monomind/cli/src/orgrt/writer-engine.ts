// packages/@monomind/cli/src/orgrt/writer-engine.ts
/**
 * Org sections spec 6.12 and 13.2 (piece P4.4): the policy engine of a role in an org with a single writer.
 * It is the ordinary `PolicyEngine` over the role's effective policy (effective-role-policy.ts), plus one
 * thing: when a file-tool write is refused and the single-writer rule is the reason (the path lies outside the
 * section's `writes`, or the role is read-only), the role is told so in the writer core's words, which name the
 * path, who may write it and what to do next (hand the change over as a document), and the refusal is recorded
 * as an audit event `writer-refused`. Every other denial, and every allow, is the base engine's, unchanged.
 * Only roles that have an overlay get this class; every other role keeps a plain `PolicyEngine`.
 */
import { isAbsolute, relative, resolve } from 'node:path';
import type { OrgBus } from './bus.js';
import type { WriterDef } from './documents/writer-policy.js';
import { mayWrite } from './documents/writer-policy.js';
import { writerView } from './documents/writer-view.js';
import { type Decision, PolicyEngine } from './policy.js';
import type { OrgDef, RolePolicy } from './types.js';

const FILE_WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** The paths a file-tool call names, as `policy.ts` reads them. */
function callPaths(input: Record<string, unknown>): string[] {
  const edits = Array.isArray(input.edits) ? (input.edits as Array<{ file_path?: unknown }>) : [];
  return [
    input.file_path,
    input.path,
    input.notebook_path,
    ...edits.map((e) => e?.file_path),
  ].filter((p): p is string => typeof p === 'string');
}

export class WriterPolicyEngine extends PolicyEngine {
  private readonly view: WriterDef;
  constructor(
    role: string,
    policy: RolePolicy,
    private readonly writerBus: OrgBus,
    private readonly workdir: string,
    roots: string[],
    private readonly project: string,
    def: OrgDef,
  ) {
    super(role, policy, writerBus, workdir, roots, project);
    this.view = writerView(def);
  }

  async decide(tool: string, input: Record<string, unknown>, callId?: string): Promise<Decision> {
    const decision = await super.decide(tool, input, callId);
    if (decision.behavior !== 'deny' || !FILE_WRITE_TOOLS.has(tool)) return decision;
    for (const p of callPaths(input)) {
      const abs = isAbsolute(p) ? p : resolve(this.workdir, p);
      const verdict = mayWrite(this.view, this.role, relative(this.workdir, abs), {
        orgRoot: this.project,
      });
      if (!verdict.applies || verdict.allowed || verdict.refusal === undefined) continue;
      this.writerBus.emit({
        type: 'audit',
        from: this.role,
        reason: 'writer-refused',
        msg: verdict.refusal,
        data: { tool, path: p },
      });
      return { behavior: 'deny', message: `[org-policy] ${verdict.refusal}` };
    }
    return decision;
  }
}
