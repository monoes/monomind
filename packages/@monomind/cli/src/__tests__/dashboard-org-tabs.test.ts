/**
 * The Orgs view's Roles, Activity and Health tabs (ported from the retired
 * standalone /orgs page): each has a button and a pane, the tab switcher
 * dispatches to its renderer, and the renderers fetch for the selected
 * project (dir=) and escape what they show.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
const TABS = ['roles', 'activity', 'health'] as const;
const XSS = '<img src=x onerror=alert(1)>';

const el = () => ({ innerHTML: '' });

function load(extra: Record<string, unknown>) {
  const panes: Record<string, { innerHTML: string }> = {
    'odt-roles': el(),
    'odt-activity': el(),
    'odt-health': el(),
  };
  const urls: string[] = [];
  const replies: Record<string, unknown> = (extra.replies as Record<string, unknown>) || {};
  const ctx = loadPageFunctions(
    dashboardScript,
    [
      'v2RenderOrgTab',
      'v2RenderOrgRoles',
      'v2RenderOrgActivity',
      '_v2ActivityText',
      'v2RenderOrgHealth',
      'esc',
      'enc',
      'relTime',
      '_rtCard',
      '_rtTable',
    ],
    {
      document: { getElementById: (id: string) => panes[id] ?? null },
      apiFetch: async (url: string) => {
        urls.push(url);
        const key = Object.keys(replies).find((k) => url.includes(k));
        if (!key) throw new Error('HTTP 404');
        return replies[key];
      },
      _v2SelOrg: 'sample-team',
      _v2OrgData: { roles: [] },
      DIR: '/work/proj a',
      ...extra,
    },
  );
  return { ctx, panes, urls };
}

describe('Orgs view: Roles, Activity and Health tabs are wired', () => {
  it.each(TABS)('%s has a secondary tab button and a pane', (tab) => {
    expect(HTML).toMatch(
      new RegExp(
        `<button class="odt-btn secondary" data-tab="${tab}"\\s+onclick="v2SwitchOrgTab\\(this\\.dataset\\.tab\\)">`,
      ),
    );
    expect(HTML).toMatch(new RegExp(`<div class="odt-pane" id="odt-${tab}"`));
  });

  it('the buttons sit inside #org-detail-tabs', () => {
    const bar = HTML.slice(HTML.indexOf('<div id="org-detail-tabs">'));
    const end = bar.indexOf('</div>\n', bar.indexOf('data-tab="health"'));
    for (const tab of TABS) expect(bar.slice(0, end)).toContain(`data-tab="${tab}"`);
  });

  it.each([
    ['activity', '/api/org/sample-team/activity?dir=%2Fwork%2Fproj%20a'],
    ['health', '/api/org/sample-team/health?dir=%2Fwork%2Fproj%20a'],
  ])('v2RenderOrgTab(%s) requests %s', async (tab, url) => {
    const { ctx, urls } = load({ _v2OrgTab: tab });
    await ctx.v2RenderOrgTab(tab);
    expect(urls).toContain(url);
  });

  it('health also reads the org memory for the same project', async () => {
    const { ctx, urls } = load({ _v2OrgTab: 'health' });
    await ctx.v2RenderOrgHealth();
    expect(urls).toContain('/api/orgs/sample-team/memory?dir=%2Fwork%2Fproj%20a');
  });
});

describe('Orgs view tab renderers', () => {
  it('roles shows title, reporting line, responsibilities and skills, escaped', () => {
    const { ctx, panes } = load({
      _v2OrgData: {
        roles: [
          {
            id: 'boss',
            title: 'Editor',
            type: 'boss',
            reports_to: null,
            responsibilities: ['Own the calendar'],
          },
          {
            id: 'w',
            title: XSS,
            type: 'specialist',
            reports_to: 'boss',
            responsibilities: [XSS],
            skills: ['seo'],
          },
        ],
      },
    });
    ctx.v2RenderOrgTab('roles');
    const html = panes['odt-roles'].innerHTML;
    expect(html).toContain('Leads the org');
    expect(html).toContain('Reports to Editor');
    expect(html).toContain('Own the calendar');
    expect(html).toContain('seo');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x');
  });

  it('activity lists events newest first as the route returns them, escaped', async () => {
    const { ctx, panes } = load({
      _v2OrgTab: 'activity',
      replies: {
        '/activity': [
          { type: 'approval', ts: Date.now() - 60_000, role: 'w', msg: XSS },
          {
            type: 'org:question',
            ts: Date.now() - 120_000,
            from: 'writer',
            question: 'Approval required for Bash',
          },
          { type: 'org:create', ts: Date.now() - 3_600_000, msg: 'Org created' },
        ],
      },
    });
    await ctx.v2RenderOrgActivity();
    const html = panes['odt-activity'].innerHTML;
    expect(html).toContain('RECENT ACTIVITY (3)');
    expect(html).toContain('writer — Approval required for Bash');
    expect(html).toContain('org:create');
    expect(html.indexOf('approval')).toBeLessThan(html.indexOf('org:create'));
    expect(html).not.toContain('<img');
  });

  it('activity shows the failure instead of a blank pane', async () => {
    const { ctx, panes } = load({ _v2OrgTab: 'activity' });
    await ctx.v2RenderOrgActivity();
    expect(panes['odt-activity'].innerHTML).toContain('Failed: HTTP 404');
  });

  it('health shows the 7-day success rate, zero counts, problems and org memory', async () => {
    const { ctx, panes } = load({
      _v2OrgTab: 'health',
      replies: {
        '/health': {
          run_success_rate_7d: 67,
          total_runs_7d: 3,
          agents_running: 0,
          agents_idle: 3,
          tasks_pending: 0,
          open_issues: 0,
          in_progress_issues: 0,
          errors: [XSS],
        },
        '/memory': {
          nodes: 4,
          edges: 2,
          rules: 1,
          glossary: ['Brief'],
          ruleTexts: ['Keep drafts short'],
        },
      },
    });
    await ctx.v2RenderOrgHealth();
    const html = panes['odt-health'].innerHTML;
    expect(html).toContain('67%');
    expect(html).toContain('3 runs');
    expect(html).toMatch(/AGENTS<\/div>\s*<div[^>]*>0<\/div>/);
    expect(html).toContain('ORG MEMORY — 4 ENTITIES · 2 RELATIONS · 1 RULES');
    expect(html).toContain('Keep drafts short');
    expect(html).not.toContain('<img');
  });

  it('health still renders when the memory read fails', async () => {
    const { ctx, panes } = load({
      _v2OrgTab: 'health',
      replies: { '/health': { run_success_rate_7d: null, errors: [] } },
    });
    await ctx.v2RenderOrgHealth();
    const html = panes['odt-health'].innerHTML;
    expect(html).toContain('SUCCESS (7 DAYS)');
    expect(html).toContain('None detected');
    expect(html).not.toContain('ORG MEMORY');
  });

  it('a reply for an org that is no longer selected is dropped', async () => {
    const { ctx, panes } = load({ _v2OrgTab: 'activity', replies: { '/activity': [] } });
    const p = ctx.v2RenderOrgActivity();
    ctx._v2SelOrg = 'other';
    await p;
    expect(panes['odt-activity'].innerHTML).not.toContain('RECENT ACTIVITY');
  });
});
