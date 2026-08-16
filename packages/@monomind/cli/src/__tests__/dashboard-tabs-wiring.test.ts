import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(__dirname, '../ui/dashboard.html'), 'utf-8');

describe('dashboard.html — Approvals/Budgets/Decisions tabs are wired into the DOM', () => {
  it('has a tab button and pane for approvals', () => {
    expect(DASHBOARD_HTML).toMatch(/data-tab="approvals"[^>]*onclick="v2SwitchOrgTab\('approvals'\)"/);
    expect(DASHBOARD_HTML).toMatch(/<div class="odt-pane" id="odt-approvals">/);
  });

  it('has a tab button and pane for budgets', () => {
    expect(DASHBOARD_HTML).toMatch(/data-tab="budgets"[^>]*onclick="v2SwitchOrgTab\('budgets'\)"/);
    expect(DASHBOARD_HTML).toMatch(/<div class="odt-pane" id="odt-budgets">/);
  });
});
