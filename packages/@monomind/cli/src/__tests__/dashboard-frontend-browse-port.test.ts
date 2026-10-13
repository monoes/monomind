import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveBrowsePort } from '../ui/server-routes-pages.mjs';

const html = readFileSync(join(__dirname, '..', 'ui', 'dashboard.html'), 'utf-8');

describe('browse dashboard port', () => {
  it('defaults to 4243 and honours a valid env override', () => {
    expect(resolveBrowsePort({})).toBe(4243);
    expect(resolveBrowsePort({ MONOMIND_BROWSE_DASHBOARD_PORT: '5555' })).toBe(5555);
  });

  it('ignores a malformed override', () => {
    for (const v of ['abc', '0', '70000', '12.5', '']) {
      expect(resolveBrowsePort({ MONOMIND_BROWSE_DASHBOARD_PORT: v })).toBe(4243);
    }
  });

  it('dashboard.html uses the injected meta through one constant', () => {
    expect(html).toContain('meta[name="mm-browse-port"]');
    expect(html).not.toMatch(/localhost:4243/);
  });

  it('the auth credential is not attached to cross-origin fetches', () => {
    expect(html).toContain('_mmSameOrigin(input)');
  });
});
