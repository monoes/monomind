import { readFileSync } from 'node:fs';
import { PLATFORM_IDS } from './registry.js';
import {
  CAPABILITIES,
  type Capability,
  type PlatformId,
  type VerificationEvidence,
} from './types.js';

export interface VerificationLedgerRow extends VerificationEvidence {
  platform: PlatformId;
  capability: Capability;
}

/** Read and validate the checked-in evidence ledger before it is compared to the registry. */
export function readVerificationLedger(filePath: string): VerificationLedgerRow[] {
  const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!Array.isArray(value)) throw new Error('Verification ledger must be a JSON array');
  return value.map((row, index) => {
    if (!row || typeof row !== 'object')
      throw new Error(`Invalid verification ledger row ${index}`);
    const candidate = row as Partial<VerificationLedgerRow>;
    if (
      !candidate.platform ||
      !(PLATFORM_IDS as readonly string[]).includes(candidate.platform) ||
      !candidate.capability ||
      !(CAPABILITIES as readonly string[]).includes(candidate.capability) ||
      !candidate.level ||
      !candidate.verifiedAt
    ) {
      throw new Error(`Invalid verification ledger row ${index}`);
    }
    return candidate as VerificationLedgerRow;
  });
}
