// #365: the machine-local HMAC signing key for access_ack grants.
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureFullAccessGrantKey,
  fullAccessGrantKeyPath,
  readFullAccessGrantKey,
  signAccessAck,
  verifyAccessAckSignature,
} from '../orgrt/access-grant-key.js';
import { mkdtempSync } from './tmp-track.js';

function dir(): string {
  return mkdtempSync(join(tmpdir(), 'access-grant-key-'));
}

describe('ensureFullAccessGrantKey / readFullAccessGrantKey', () => {
  it('creates a 32-byte key file at mode 0600', () => {
    const d = dir();
    const key = ensureFullAccessGrantKey(d);
    expect(key.length).toBe(32);
    const st = statSync(fullAccessGrantKeyPath(d));
    expect(st.mode & 0o777).toBe(0o600);
  });

  it('is idempotent — a second call returns the SAME key', () => {
    const d = dir();
    const a = ensureFullAccessGrantKey(d);
    const b = ensureFullAccessGrantKey(d);
    expect(a.equals(b)).toBe(true);
  });

  it('readFullAccessGrantKey returns undefined when no key exists', () => {
    expect(readFullAccessGrantKey(dir())).toBeUndefined();
  });

  it('readFullAccessGrantKey returns undefined for an unreadable path (no such dir)', () => {
    expect(readFullAccessGrantKey(join(dir(), 'does', 'not', 'exist'))).toBeUndefined();
  });
});

describe('signAccessAck / verifyAccessAckSignature', () => {
  it('a signature verifies against the same key and inputs', () => {
    const key = ensureFullAccessGrantKey(dir());
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    const sig = signAccessAck({ ...args, key });
    expect(verifyAccessAckSignature({ ...args, sig, key })).toBe(true);
  });

  it('fails when the key differs', () => {
    const key1 = ensureFullAccessGrantKey(dir());
    const key2 = ensureFullAccessGrantKey(dir());
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    const sig = signAccessAck({ ...args, key: key1 });
    expect(verifyAccessAckSignature({ ...args, sig, key: key2 })).toBe(false);
  });

  it('fails when any signed field differs (org, role, hash, at, by)', () => {
    const key = ensureFullAccessGrantKey(dir());
    const base = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    const sig = signAccessAck({ ...base, key });
    expect(verifyAccessAckSignature({ ...base, org: 'other', sig, key })).toBe(false);
    expect(verifyAccessAckSignature({ ...base, role: 'other', sig, key })).toBe(false);
    expect(verifyAccessAckSignature({ ...base, hash: 'other', sig, key })).toBe(false);
    expect(verifyAccessAckSignature({ ...base, at: 'other', sig, key })).toBe(false);
  });

  it('fails when there is no key at all', () => {
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    expect(verifyAccessAckSignature({ ...args, sig: 'deadbeef'.repeat(8), key: undefined })).toBe(
      false,
    );
  });

  it('fails when there is no sig at all', () => {
    const key = ensureFullAccessGrantKey(dir());
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    expect(verifyAccessAckSignature({ ...args, sig: undefined, key })).toBe(false);
  });

  it('fails for a malformed (non-hex) sig without throwing', () => {
    const key = ensureFullAccessGrantKey(dir());
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    expect(() => verifyAccessAckSignature({ ...args, sig: 'not-hex-!!', key })).not.toThrow();
    expect(verifyAccessAckSignature({ ...args, sig: 'not-hex-!!', key })).toBe(false);
  });

  it('fails for a well-formed but wrong-length sig without throwing', () => {
    const key = ensureFullAccessGrantKey(dir());
    const args = { org: 'o', role: 'builder', hash: 'h', at: 'a', by: 'human' };
    expect(verifyAccessAckSignature({ ...args, sig: 'ab', key })).toBe(false);
  });
});
