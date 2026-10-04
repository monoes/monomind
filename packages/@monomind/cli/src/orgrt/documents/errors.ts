// orgrt/documents/errors.ts
//
// Typed errors with stable codes for the document dialects (schema, checks, contract). A code is part of the
// contract with the tools that map it to a message (org_doc_* in later pieces): codes are never renamed or
// reused, only added. Every problem carries the path it was found at, so one failure can name all its reasons.
export const DOC_ERROR_CODES = [
  'SCHEMA_NOT_OBJECT',
  'SCHEMA_UNSUPPORTED_KEYWORD',
  'SCHEMA_INVALID_KEYWORD_VALUE',
  'SCHEMA_UNKNOWN_TYPE',
  'SCHEMA_NOT_JSON',
  'SCHEMA_TOO_LARGE',
  'SCHEMA_TOO_DEEP',
  'SCHEMA_REF_INVALID',
  'SCHEMA_REF_ESCAPE',
  'SCHEMA_REF_UNREADABLE',
  'SCHEMA_REF_NOT_JSON',
  'CHECK_NOT_LIST',
  'CHECK_NEEDS_TYPE',
  'CHECK_UNKNOWN_TYPE',
  'CHECK_UNKNOWN_PARAM',
  'CHECK_BAD_PARAM',
  'CONTRACT_NOT_OBJECT',
  'CONTRACT_UNKNOWN_FIELD',
  'CONTRACT_INVALID_FIELD',
  'CANONICAL_UNSUPPORTED_VALUE',
] as const;
export type DocErrorCode = (typeof DOC_ERROR_CODES)[number];

export const VALUE_PROBLEM_CODES = [
  'VALUE_NOT_JSON',
  'VALUE_TYPE',
  'VALUE_ENUM',
  'VALUE_CONST',
  'VALUE_TOO_SHORT',
  'VALUE_TOO_LONG',
  'VALUE_BELOW_MINIMUM',
  'VALUE_ABOVE_MAXIMUM',
  'VALUE_TOO_FEW_ITEMS',
  'VALUE_TOO_MANY_ITEMS',
  'VALUE_REQUIRED',
  'VALUE_NOT_ALLOWED',
] as const;
export type ValueProblemCode = (typeof VALUE_PROBLEM_CODES)[number];

/** One reason a schema, check list or contract is refused. */
export interface DocProblem {
  code: DocErrorCode;
  /** Where it was found: `$.properties.a.pattern`, `checks[1]`, `contract.max_bytes`. */
  path: string;
  message: string;
  /** What to do about it, when there is something to say. */
  remedy?: string;
}

/** One way a value fails a schema (a document body that does not conform, not a bad schema). */
export interface ValueProblem {
  code: ValueProblemCode;
  path: string;
  message: string;
}

export const problemText = (p: { path: string; message: string; remedy?: string }): string =>
  `${p.path}: ${p.message}${p.remedy ? ` (${p.remedy})` : ''}`;

export class DocError extends Error {
  readonly code: DocErrorCode;
  readonly problems: DocProblem[];
  constructor(problems: DocProblem[]) {
    super(problems.map(problemText).join('; '));
    this.name = 'DocError';
    this.problems = problems;
    this.code = problems[0].code;
  }
}

export function throwIfProblems(problems: DocProblem[]): void {
  if (problems.length) throw new DocError(problems);
}
