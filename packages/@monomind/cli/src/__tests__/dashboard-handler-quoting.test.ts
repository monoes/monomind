/**
 * Values interpolated into the JS of a generated inline handler.
 *
 * esc() HTML-escapes ' to &#39;, and the browser decodes the attribute back to '
 * before the handler's JS runs, so '${esc(x)}' alone does not keep x inside its
 * JS string. Generated handlers must either escape quotes for JS first
 * (String(x).replace(/['\\]/g,'\\$&')) or pass the value through a data-*
 * attribute and read it from this.dataset.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardScript, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');

/** Lines where an on*="..." handler puts a bare esc() value inside a JS string literal. */
function bareEscArgs(html: string): number[] {
  return [...html.matchAll(/\bon[a-z]+="[^"]*'\$\{esc\((?!String\([^)]*\)\.replace\()/g)].map(
    (m) => html.slice(0, m.index).split('\n').length,
  );
}

describe('generated inline handlers', () => {
  it("never put a bare '${esc(...)}' inside a JS string", () => {
    expect(bareEscArgs(HTML)).toEqual([]);
  });

  it('the check catches the unsafe form and accepts the two safe ones', () => {
    expect(bareEscArgs(`<b onclick="view('\${esc(e.key)}')">`)).toEqual([1]);
    expect(
      bareEscArgs(`<b onclick="view('\${esc(String(k).replace(/['\\\\]/g,'\\\\$&'))}')">`),
    ).toEqual([]);
    expect(bareEscArgs(`<b data-key="\${esc(e.key)}" onclick="view(this.dataset.key)">`)).toEqual(
      [],
    );
  });

  it('Memory › Store rows pass key, namespace and id through data-* attributes', () => {
    const fn = /async function loadStoreEntries[\s\S]*?\n}\n/.exec(dashboardScript)?.[0] ?? '';
    expect(fn).toContain('onclick="viewStoreEntry(this.dataset.key,this.dataset.ns)"');
    expect(fn).toContain(
      'onclick="deleteStoreEntry(this.dataset.id,this.dataset.key,this.dataset.ns)"',
    );
  });
});
