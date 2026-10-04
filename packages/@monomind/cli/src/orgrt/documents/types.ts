// orgrt/documents/types.ts
//
// Types of the document contract as the runtime pins it (org sections spec 6.2): the resolved, effective form,
// with every default filled in, so two spellings of one contract are one contract and hash alike.
import type { Check } from './checks.js';
import type { JsonObject } from './json.js';

/** What a contract requires of a publish: `min` entries of `kind` in the publish `evidence` argument (spec 6.3). */
export interface EvidenceRequirement {
  kind: 'command' | 'diff' | 'document' | 'source';
  /** command: `reported`; source: `cited`; diff and document take none (always checked by the runtime). */
  verify?: 'reported' | 'cited';
  min: number;
}

/** A file in the producer's workspace that one part of the document must equal (the prototype's `deliverables`). */
export interface DeliverableFile {
  /** Workspace-relative path. */
  file: string;
  /** The part of the document that must equal the file: the element of `array` whose `key` is `value`. */
  select: { array: string; key: string; value: string };
  /** Dotted field paths, `[]` for every element of a list: "module", "answers[].q". */
  compare: string[];
}

export interface DocContract {
  /** Document type name: `^[a-z][a-z0-9-]{0,39}$`, never a reserved built-in. */
  type: string;
  /** The resolved org-schema-v1 schema (inline contents, never a path). */
  schema: JsonObject;
  evidence: EvidenceRequirement[];
  checks: Check[];
  deliverable_files: DeliverableFile[];
  acceptance: 'each';
  visibility: 'consumers' | 'org';
  on_stale: 'hold';
  gates: never[];
  max_publish_attempts: number;
  max_consistency_refusals: number;
  /** Serialized bytes a version may hold, evidence included. */
  max_bytes: number;
}

/** A contract as authored: only `type` and `schema` are required. */
export type DocContractInput = Pick<DocContract, 'type' | 'schema'> &
  Partial<Omit<DocContract, 'type' | 'schema'>>;
