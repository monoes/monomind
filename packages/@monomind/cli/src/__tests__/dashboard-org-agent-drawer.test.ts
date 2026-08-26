import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(__dirname, '../ui/dashboard.html'), 'utf-8');

describe('dashboard.html — org agent drawer', () => {
  it('keeps the chart role click handler available to inline event attributes', () => {
    expect(DASHBOARD_HTML).toMatch(/onclick="v2OpenAgent\('/);
    expect(DASHBOARD_HTML).toMatch(/window\.v2OpenAgent\s*=\s*_v2OpenAgent/);
  });
});
