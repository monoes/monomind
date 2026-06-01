import { describe, it, expect } from 'vitest';
import { getServerInfo } from '../../web/api.js';

describe('getServerInfo', () => {
  it('returns version and nodeVersion', () => {
    const info = getServerInfo();
    expect(info.version).toBeDefined();
    expect(typeof info.version).toBe('string');
    expect(info.nodeVersion).toBe(process.version);
    expect(info.name).toBe('monograph');
  });

  it('includes uptime', () => {
    const info = getServerInfo();
    expect(typeof info.uptimeSeconds).toBe('number');
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
