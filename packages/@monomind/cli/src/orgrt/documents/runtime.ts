// packages/@monomind/cli/src/orgrt/documents/runtime.ts
//
// The per-run documents runtime (org sections plan P3.6): one object per run, created at org start only when
// the sections surface is on (sectionsSurface(def).enabled; the eval gate of P3.3 has already passed), closed
// at stop. It builds the contract bindings from the validated definition, opens the P3.5 store in
// `<orgDir>/docs/<run>` (reopened, and its state replayed, when a run resumes), holds the static access rules,
// and hands each role session a host bound to that role. An org without the surface never gets one, so it has
// no docs directory and no new state. The store (with its `addGuard` and `onCommitted` seams) is exposed for
// the pieces that follow: notices, relay, deliverable consistency and checks.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgDef } from '../types.js';
import { DocAccess, sectionRoster } from './access.js';
import { CheckJournal } from './check-journal.js';
import { PartJournal } from './part-journal.js';
import { contractRevision } from './contract.js';
import { deliverableGuard } from './deliverable-guards.js';
import { createHost, type DocumentToolHost } from './host.js';
import { NoticeEngine } from './notices.js';
import { rootRoleId } from './routing.js';
import { DocumentStore } from './store.js';
import type { TypeBinding } from './store-types.js';
import { sectionsSurface } from './surface.js';

export type { DocumentToolHost } from './host.js';

/** The contract fields the definition's `documents.<type>` may carry into the store (the rest of the entry,
 *  `owner`, `provisional` and `confidential`, only holds a default here: validation refuses any other value). */
const CONTRACT_FIELDS = [
  'schema',
  'evidence',
  'checks',
  'deliverable_files',
  'acceptance',
  'visibility',
  'on_stale',
  'gates',
  'max_publish_attempts',
  'max_consistency_refusals',
  'max_bytes',
] as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The section that leads: its declared lead, else its first member (a one-member section leads itself). */
const leadOf = (def: OrgDef, name: string): string | undefined => {
  const s = (def as unknown as { sections: Record<string, Record<string, unknown>> }).sections[
    name
  ];
  return typeof s?.lead === 'string' ? s.lead : sectionRoster(def, name)[0];
};

/**
 * One binding per declared document type: the publishing section's roles may publish it, and each consuming
 * section is a consumer decided by its lead. Throws on a type nothing publishes (validation reports it first).
 */
export function bindingsFromDef(def: OrgDef): TypeBinding[] {
  const raw = def as unknown as { sections?: unknown; documents?: unknown };
  const sections = isObject(raw.sections) ? raw.sections : {};
  const documents = isObject(raw.documents) ? raw.documents : {};
  const has = (s: unknown, key: string, type: string): boolean =>
    isObject(s) && Array.isArray(s[key]) && (s[key] as unknown[]).includes(type);
  return Object.entries(documents).map(([type, doc]) => {
    const contract: Record<string, unknown> = { type };
    if (isObject(doc))
      for (const k of CONTRACT_FIELDS) if (doc[k] !== undefined) contract[k] = doc[k];
    const publisher = Object.keys(sections).find((n) => has(sections[n], 'publishes', type));
    if (!publisher) throw new Error(`documents.${type}: no section publishes it`);
    return {
      contract: contract as unknown as TypeBinding['contract'],
      section: publisher,
      producers: sectionRoster(def, publisher),
      consumers: Object.keys(sections)
        .filter((n) => has(sections[n], 'consumes', type))
        .map((n) => ({ id: n, deciders: [leadOf(def, n) as string] })),
    };
  });
}

export class DocumentsRuntime {
  readonly access: DocAccess;
  /** Publication notices (P3.8); attached to the daemon's deliver path at org start. */
  notices?: NoticeEngine;
  /** The record of org_doc_check calls (P3.11): `<dir>/checks.jsonl`, created at the first call. */
  readonly checks: CheckJournal;
  /** Which parts of each version each role has read (P3.16b): `<dir>/part-reads.jsonl`, created at the first read. */
  readonly reads: PartJournal;
  private isClosed = false;

  constructor(
    readonly dir: string,
    readonly run: string,
    readonly store: DocumentStore,
    readonly bindings: readonly TypeBinding[],
    def: OrgDef,
  ) {
    this.access = new DocAccess(def, bindings);
    this.checks = new CheckJournal(join(dir, 'checks.jsonl'));
    this.reads = new PartJournal(join(dir, 'part-reads.jsonl'));
    // Deliverable consistency (P3.10): only contracts that declare `deliverable_files` are ever checked.
    if (bindings.some((b) => b.contract.deliverable_files?.length))
      store.addGuard(
        deliverableGuard({
          workspaceOf: (role) => this.workspaceOf?.(role),
          onChanged: (c) => this.notices?.owe(c), // P3.9: the producer is told, through the journal
        }),
      );
  }

  /** Where a producing role's own files are; bound by the org start, which knows the workspace mode. */
  private workspaceOf?: (role: string) => string | undefined;
  bindWorkspaces(f: (role: string) => string | undefined): void {
    this.workspaceOf = f;
  }

  get closed(): boolean {
    return this.isClosed;
  }

  /** The tool host of `role`: every call is made as that role, whatever the arguments say. */
  forRole(role: string): DocumentToolHost {
    return createHost(
      {
        store: this.store,
        access: this.access,
        run: this.run,
        isClosed: () => this.isClosed,
        checks: this.checks,
        reads: this.reads,
      },
      role,
    );
  }

  /** Stop accepting calls and write the store's snapshot. Idempotent; never throws. */
  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.notices?.close();
    try {
      this.store.snapshot();
    } catch {
      /* a snapshot is a cache of the log */
    }
  }
}

export interface OpenOptions {
  def: OrgDef;
  /** `.monomind/orgs/<name>`. */
  orgDir: string;
  run: string;
  now?: () => Date;
}

/** The documents runtime of a run, or undefined when the definition is off the sections surface. */
export function openDocumentsRuntime(o: OpenOptions): DocumentsRuntime | undefined {
  if (!sectionsSurface(o.def).enabled) return undefined;
  const bindings = bindingsFromDef(o.def);
  for (const b of bindings)
    try {
      contractRevision(b.contract);
    } catch (err) {
      throw new Error(
        `documents.${b.contract.type}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  const dir = join(o.orgDir, 'docs', o.run);
  mkdirSync(dir, { recursive: true });
  const store = new DocumentStore({ dir, run: o.run, bindings, ...(o.now ? { now: o.now } : {}) });
  const runtime = new DocumentsRuntime(dir, o.run, store, bindings, o.def);
  const root = rootRoleId(o.def);
  // P3.9: the short copy of a producer relay goes to the producing section's lead, else the root
  const copyTo = (section: string, producer: string): string | undefined => {
    const lead = leadOf(o.def, section);
    return lead && lead !== producer ? lead : root !== producer ? root : undefined;
  };
  runtime.notices = new NoticeEngine({ dir, store, copyTo, ...(o.now ? { now: o.now } : {}) });
  return runtime;
}
