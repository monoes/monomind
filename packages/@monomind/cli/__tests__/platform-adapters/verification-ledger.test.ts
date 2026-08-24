import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import { readVerificationLedger } from '../../src/platform-adapters/verification-ledger.js';

const ledgerPath = fileURLToPath(new URL('../../../../../docs/platforms/verification-ledger.json', import.meta.url));

describe('platform verification ledger', () => {
  it('has one cited ledger row for every native registry capability', () => {
    const ledger = readVerificationLedger(ledgerPath);
    expect(new Set(ledger.map((row) => `${row.platform}:${row.capability}`)).size).toBe(ledger.length);
    for (const adapter of Object.values(PLATFORM_REGISTRY)) {
      for (const capability of CAPABILITIES) {
        if (adapter.capabilities[capability] !== 'native') continue;
        const row = ledger.find((candidate) => candidate.platform === adapter.id && candidate.capability === capability);
        expect(row).toEqual({ platform: adapter.id, capability, ...adapter.verification[capability] });
      }
    }
  });
});
