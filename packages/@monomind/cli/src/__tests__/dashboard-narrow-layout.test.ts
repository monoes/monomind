/**
 * Narrow screens: below 760px the sidebar is a drawer opened from the topbar
 * and side-by-side panes stack. Before, the fixed 195px sidebar left half a
 * phone screen for content, which was clipped on the right.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
const NARROW = /@media \(max-width: 760px\) \{([\s\S]*?)\n\}\n/.exec(HTML)?.[1] ?? '';

describe('narrow-screen layout', () => {
  it('turns the sidebar into an off-canvas drawer', () => {
    expect(NARROW).toMatch(/#sidebar \{ position: fixed;[^}]*transform: translateX\(-100%\)/);
    expect(NARROW).toMatch(/#app\.nav-open #sidebar \{ transform: none;/);
    expect(NARROW).toMatch(/#nav-toggle \{ display: inline-flex; \}/);
    expect(HTML).toMatch(/#nav-toggle, #nav-backdrop \{ display: none; \}/);
  });

  it('stacks the Now and Orgs panes instead of clipping them', () => {
    expect(NARROW).toContain('#view-now, #view-orgs { flex-direction: column; }');
    expect(NARROW).toContain('#metrics-pane { width: auto;');
    expect(NARROW).toContain('#orgs-list-pane { width: auto;');
  });

  it('has an accessible menu button and a backdrop that closes the drawer', () => {
    expect(HTML).toContain(
      '<button class="btn" id="nav-toggle" onclick="toggleNav()" aria-label="Open navigation" aria-expanded="false" aria-controls="sidebar">',
    );
    expect(HTML).toContain('<div id="nav-backdrop" onclick="toggleNav(false)"></div>');
  });

  it('topbar buttons keep an accessible name when their label is hidden', () => {
    for (const label of ['Budget', 'Search', 'Help', 'Refresh']) {
      expect(HTML).toMatch(
        new RegExp(`aria-label="${label}">[^<]*<span class="tb-lbl"> ${label}</span>`),
      );
    }
  });

  it('picking a view closes the drawer', () => {
    expect(dashboardScript).toContain(
      "el.addEventListener('click', () => { switchView(el.dataset.view); toggleNav(false); });",
    );
  });

  it('toggleNav flips the drawer and aria-expanded', () => {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    const app = {
      classList: {
        contains: (c: string) => classes.has(c),
        toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
      },
    };
    const btn = { setAttribute: (k: string, v: string) => (attrs[k] = v) };
    const ctx = loadPageFunctions(dashboardScript, ['toggleNav'], {
      document: { getElementById: (id: string) => (id === 'app' ? app : btn) },
    });
    ctx.toggleNav();
    expect(classes.has('nav-open')).toBe(true);
    expect(attrs['aria-expanded']).toBe('true');
    ctx.toggleNav(false);
    expect(classes.has('nav-open')).toBe(false);
    expect(attrs['aria-expanded']).toBe('false');
  });
});
