import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML = readFileSync(join(__dirname, '../ui/dashboard.html'), 'utf-8');

describe('dashboard.html — Approvals and Decisions tabs are wired into the DOM', () => {
  it('has a tab button and pane for approvals', () => {
    expect(DASHBOARD_HTML).toMatch(
      /data-tab="approvals"[^>]*onclick="v2SwitchOrgTab\('approvals'\)"/,
    );
    expect(DASHBOARD_HTML).toMatch(/<div class="odt-pane" id="odt-approvals">/);
  });

  it('has a tab button and pane for decisions, and a render function reading /api/org/:name/gates', () => {
    expect(DASHBOARD_HTML).toMatch(
      /data-tab="decisions"[^>]*onclick="v2SwitchOrgTab\('decisions'\)"/,
    );
    expect(DASHBOARD_HTML).toMatch(/<div class="odt-pane" id="odt-decisions">/);
    expect(DASHBOARD_HTML).toMatch(/tab === 'decisions'\)\s*v2RenderOrgDecisions\(\)/);
    expect(DASHBOARD_HTML).toMatch(/function v2RenderOrgDecisions/);
    expect(DASHBOARD_HTML).toMatch(/\/api\/org\/\$\{_enc\}\/gates/);
  });
});
