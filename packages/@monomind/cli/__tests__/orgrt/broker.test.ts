import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerOrg, unregisterOrg, lookupOrg, BrokerLease } from '../../src/orgrt/broker.js';

describe('broker registry', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'broker-')); });

  it('registers and looks up an org', () => {
    registerOrg('alpha', 'http://127.0.0.1:9001', dir);
    const entry = lookupOrg('alpha', dir);
    expect(entry?.url).toBe('http://127.0.0.1:9001');
    expect(entry?.pid).toBe(process.pid);
  });

  it('returns null for an org that was never registered', () => {
    expect(lookupOrg('nobody-here', dir)).toBeNull();
  });

  it('unregister removes the entry', () => {
    registerOrg('alpha', 'http://127.0.0.1:9001', dir);
    unregisterOrg('alpha', dir);
    expect(lookupOrg('alpha', dir)).toBeNull();
    expect(existsSync(join(dir, 'alpha.json'))).toBe(false);
  });

  it('treats a stale registration (owner crashed without cleanup) as unregistered', () => {
    registerOrg('alpha', 'http://127.0.0.1:9001', dir);
    // staleMs=0 means "any age counts as stale"
    expect(lookupOrg('alpha', dir, 0)).toBeNull();
  });

  it('rejects unsafe org names to prevent path escapes via the registry file path', () => {
    expect(() => registerOrg('../../etc/passwd', 'http://x', dir)).toThrow();
  });

  it('enforces SAFE_NAME regex: requires alphanumerics, hyphens, underscores only', () => {
    // Valid names
    expect(() => registerOrg('valid-name_123', 'http://x', dir)).not.toThrow();
    expect(() => registerOrg('Alpha', 'http://x', dir)).not.toThrow();
    expect(() => registerOrg('a-b', 'http://x', dir)).not.toThrow();

    // Invalid names
    expect(() => registerOrg('a', 'http://x', dir)).toThrow(); // too short (min 2 chars)
    expect(() => registerOrg('name with spaces', 'http://x', dir)).toThrow();
    expect(() => registerOrg('name.with.dots', 'http://x', dir)).toThrow();
    expect(() => registerOrg('name@with_special', 'http://x', dir)).toThrow();
    expect(() => registerOrg('-starts-with-dash', 'http://x', dir)).toThrow(); // must start alphanumerically
    expect(() => registerOrg('_starts-with-underscore', 'http://x', dir)).toThrow();
  });
});

describe('BrokerLease', () => {
  it('registers on start and heartbeats on an interval, unregisters on stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'broker-lease-'));
    const lease = new BrokerLease('alpha', 'http://127.0.0.1:9001', dir, 50);
    lease.start();
    expect(lookupOrg('alpha', dir)).not.toBeNull();

    const first = lookupOrg('alpha', dir)!.updatedAt;
    await new Promise(r => setTimeout(r, 120));
    const second = lookupOrg('alpha', dir)!.updatedAt;
    expect(second).toBeGreaterThanOrEqual(first); // heartbeat re-wrote it

    lease.stop();
    expect(lookupOrg('alpha', dir)).toBeNull();
  });

  it('stores and retrieves credential in the broker entry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'broker-cred-'));
    const testCred = 'test-credential-abc123';
    registerOrg('secure', 'http://127.0.0.1:9001', dir, testCred);
    const entry = lookupOrg('secure', dir);
    expect(entry?.credential).toBe(testCred);
  });

  it('normalizes empty/invalid credentials to undefined', () => {
    const dir = mkdtempSync(join(tmpdir(), 'broker-cred-norm-'));
    registerOrg('test', 'http://127.0.0.1:9001', dir, '');
    const entry1 = lookupOrg('test', dir);
    expect(entry1?.credential).toBeUndefined();

    registerOrg('test2', 'http://127.0.0.1:9002', dir, '  ');
    const entry2 = lookupOrg('test2', dir);
    expect(entry2?.credential).toBeUndefined();
  });
});
