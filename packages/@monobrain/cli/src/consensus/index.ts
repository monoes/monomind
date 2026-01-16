/**
 * Consensus module barrel export (Task 36)
 */

export { deriveSigningKey, signVote, verifyVote } from './vote-signer.js';
export { AuditWriter } from './audit-writer.js';
export type { RecordInput } from './audit-writer.js';
