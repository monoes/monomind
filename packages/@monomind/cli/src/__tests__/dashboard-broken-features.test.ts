/**
 * Dashboard controls that rendered but did not work (review of 2026-11-20).
 * Each block names the control, what it did before, and asserts the fixed
 * behaviour through the page's real functions (vm harness) or, for markup and
 * routes, against the page source and a live server.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../ui/server.mjs';
import { dashboardScript, loadPageFunctions, UI_DIR } from './dashboard-script.js';

const HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');

/** Source of a `window.NAME = async () => { ... };` handler (they are not top-level functions). */
function windowHandler(name: string): string {
  const start = dashboardScript.indexOf(`window.${name} = `);
  if (start < 0) throw new Error(`window.${name} not found`);
  const end = dashboardScript.indexOf('\n};\n', start);
  return dashboardScript.slice(start, end + 3);
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe('authenticated loads: no /api URL in a src, href or window.open', () => {
  // Only fetch() (wrapped to add the token header) and mmEventSource carry the
  // token. An iframe src, <img src>, link or window.open to /api answered 401:
  // the Monograph graph, OPEN IN TAB, Export > HTML and the Orgs > Files image preview.
  it('the page builds no navigation to an /api route', () => {
    const offenders = [
      ...HTML.matchAll(/(?:\.src\s*=|\.href\s*=|\bsrc="|\bhref="|window\.open\()\s*[`'"]?\/api\//g),
      ...HTML.matchAll(/<img src="\$\{esc\(fileUrl\)\}"/g),
    ].map((m) => HTML.slice(0, m.index).split('\n').length);
    expect(offenders).toEqual([]);
  });

  it('the graph iframe is sandboxed without same-origin access', () => {
    const tag = /<iframe id="mg-iframe"[^>]*>/.exec(HTML)?.[0] ?? '';
    expect(tag).toContain('sandbox="allow-scripts"');
    expect(tag).not.toContain('allow-same-origin');
    expect(tag).not.toMatch(/\ssrc=/);
  });

  it('mgInitGraph loads the graph through fetch() into srcdoc', async () => {
    const frame: Record<string, string> = {};
    const calls: string[] = [];
    const ctx = loadPageFunctions(dashboardScript, ['mgGraphHtml', 'mgInitGraph', 'esc'], {
      DIR: '/p',
      enc: encodeURIComponent,
      fetch: async (u: string) => {
        calls.push(u);
        return { ok: true, text: async () => '<html>graph</html>' };
      },
      document: { getElementById: () => frame },
    });
    await ctx.mgInitGraph();
    expect(calls).toEqual(['/api/monograph-html?dir=%2Fp']);
    expect(frame.srcdoc).toBe('<html>graph</html>');
    expect(frame.src).toBeUndefined();
  });

  it('a failed graph load shows the error instead of a 401 page', async () => {
    const frame: Record<string, string> = {};
    const ctx = loadPageFunctions(dashboardScript, ['mgGraphHtml', 'mgInitGraph', 'esc'], {
      DIR: '/p',
      enc: encodeURIComponent,
      fetch: async () => ({ ok: false, status: 500 }),
      document: { getElementById: () => frame },
    });
    await ctx.mgInitGraph();
    expect(frame.srcdoc).toContain('Graph unavailable (HTTP 500)');
  });

  it('the open-in-tab page escapes the graph into a sandboxed srcdoc', () => {
    const ctx = loadPageFunctions(dashboardScript, ['mgSandboxedPage', 'esc']);
    const page = ctx.mgSandboxedPage('<p class="x">a & b</p>');
    expect(page).toContain(
      '<iframe sandbox="allow-scripts" srcdoc="&lt;p class=&quot;x&quot;&gt;a &amp; b&lt;/p&gt;">',
    );
  });
});

describe('budget alerts', () => {
  const ctx = loadPageFunctions(dashboardScript, ['budgetLevel'], {
    fmtCost: (c: number) => `$${c.toFixed(2)}`,
  });

  it('checks the monthly limit, which was saved but never read', () => {
    const level = ctx.budgetLevel({ monthly: 100 }, { todayCost: 1, monthCost: 120 });
    expect(level).toMatchObject({ id: 'budget-monthly-over', cls: 'alert-crit' });
  });

  it('reports the most severe level, daily first', () => {
    expect(ctx.budgetLevel({ daily: 10, monthly: 100 }, { todayCost: 11, monthCost: 85 }).id).toBe(
      'budget-daily-over',
    );
    expect(ctx.budgetLevel({ daily: 10, monthly: 100 }, { todayCost: 5, monthCost: 85 }).id).toBe(
      'budget-monthly-warn',
    );
    expect(ctx.budgetLevel({ daily: 10 }, { todayCost: 5, monthCost: 0 })).toBeNull();
  });

  it('notifies once per level per day, not on every refresh', () => {
    let notified = 0;
    const page = loadPageFunctions(dashboardScript, ['budgetLevel', 'checkBudget'], {
      fmtCost: (c: number) => `$${c}`,
      budget: { daily: 10 },
      alertState: { todayCost: 9, monthCost: 9 },
      dismissedAlerts: new Set(),
      _budgetNotified: new Set(),
      maybeNotify: () => notified++,
      updateAlerts: () => {},
    });
    page.checkBudget();
    page.checkBudget();
    expect(notified).toBe(1);
    expect(page.alertState.budgetId).toBe('budget-daily-warn');
  });
});

describe('small broken controls', () => {
  it('Now > Recent Sessions shows "None" instead of "Loading…" forever', () => {
    const el = { innerHTML: '<div class="loading-txt">Loading…</div>' };
    const ctx = loadPageFunctions(dashboardScript, ['renderMiniSessions'], {
      document: { getElementById: () => el },
    });
    ctx.renderMiniSessions([]);
    expect(el.innerHTML).toContain('>None<');
  });

  it('the org list filter targets the rendered list (#orgs-list-content was replaced)', () => {
    const selectors: string[] = [];
    const items = [
      { textContent: 'sample-team', style: { display: '' } },
      { textContent: 'dev-team', style: { display: '' } },
    ];
    const ctx = loadPageFunctions(dashboardScript, ['_filterOrgList'], {
      document: {
        querySelectorAll: (s: string) => {
          selectors.push(s);
          return items;
        },
      },
    });
    ctx._filterOrgList('sample');
    expect(selectors).toEqual(['#orgs-list-scroll .org-item']);
    expect(HTML).toMatch(/getElementById\('orgs-list-scroll'\)/);
    expect(items.map((i) => i.style.display)).toEqual(['', 'none']);
  });

  it('every number key opens a view that exists', () => {
    const keys = /const _vkeys = (\{[^}]*\})/.exec(dashboardScript)?.[1] ?? '{}';
    const views = Object.values(JSON.parse(keys.replace(/'/g, '"'))) as string[];
    expect(views.length).toBe(9);
    for (const v of views) expect(HTML, `#view-${v}`).toContain(`id="view-${v}"`);
  });

  it('the shortcut help lists the view keys and M', () => {
    const help = HTML.slice(
      HTML.indexOf('<div id="shortcut-box">'),
      HTML.indexOf('<!-- budget modal'),
    );
    expect(help).toContain('<kbd>9</kbd>');
    expect(help).toContain('Mastermind overlay');
  });

  it('the palette offers only the org tabs the org room has', () => {
    expect(dashboardScript).not.toContain("'heartbeats'");
    expect(dashboardScript).toContain(
      "document.querySelectorAll('#org-detail-tabs .odt-btn[data-tab]')",
    );
  });

  it('memory text is escaped once', () => {
    const fn = /function _selectMem[\s\S]*?\n}\n/.exec(dashboardScript)?.[0] ?? '';
    expect(fn).toContain('<strong>${g}</strong>');
    expect(fn).not.toContain('${esc(g)}');
  });

  it('empty-state hints name commands that exist', () => {
    expect(HTML).not.toContain('autodev');
  });

  it('the Mastermind Loops/Metrics Refresh button survives the load', () => {
    const body = { innerHTML: '', lastElementChild: { innerHTML: '' } };
    const rendered: unknown[] = [];
    const ctx = loadPageFunctions(dashboardScript, ['mmSwitchTab'], {
      document: { querySelectorAll: () => [], getElementById: () => body },
      mmRenderLoops: (el: unknown) => rendered.push(el),
      mmRenderMetrics: (el: unknown) => rendered.push(el),
    });
    ctx.mmSwitchTab('loops');
    expect(body.innerHTML).toContain('↺ Refresh');
    expect(rendered).toEqual([body.lastElementChild]);
  });
});

describe('Memory > Store rows', () => {
  it('View prefills the current content and does not save when unchanged', async () => {
    const posted: unknown[] = [];
    const ctx = loadPageFunctions(dashboardScript, ['_viewStoreEntry'], {
      _storeEntries: [{ key: 'k', namespace: 'ns', content: 'old value' }],
      prompt: (_msg: string, value: string) => value,
      fetch: async (...a: unknown[]) => {
        posted.push(a);
        return { json: async () => ({ ok: true }) };
      },
    });
    ctx._viewStoreEntry('k', 'ns');
    await tick();
    expect(posted).toEqual([]);
  });

  it('the namespace box lists entries on Enter when the search box is empty', () => {
    expect(HTML).toContain(
      "onkeydown=\"if(event.key==='Enter'){document.getElementById('store-search-input').value.trim()?storeSearch():loadStoreEntries()}\"",
    );
  });
});

describe('Orgs > Mark Complete', () => {
  function load(fetchImpl: (u: string) => Promise<unknown>) {
    const btn = { disabled: false, textContent: 'Mark Complete' };
    const calls: string[] = [];
    const ctx = loadPageFunctions(dashboardScript, [], {
      window: {} as Record<string, unknown>,
      _v2SelOrg: 'sample-team',
      DIR: '/proj',
      document: { getElementById: () => btn },
      fetch: (u: string) => {
        calls.push(u);
        return fetchImpl(u);
      },
      showToast: () => {},
      renderOrgs: async () => {},
      v2SelectOrg: () => {},
      console: { error: () => {} },
    });
    vm.runInContext(windowHandler('v2MarkOrgComplete'), ctx as never);
    return {
      run: (ctx.window as Record<string, () => Promise<void>>).v2MarkOrgComplete,
      btn,
      calls,
    };
  }

  it('sends the selected project dir', async () => {
    const { run, calls } = load(async () => ({ ok: true, json: async () => ({}) }));
    await run();
    expect(calls).toEqual(['/api/orgs/sample-team/mark-complete?dir=%2Fproj']);
  });

  it('keeps a failure on the button instead of resetting it at once', async () => {
    const { run, btn } = load(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'No active run' }),
    }));
    await run();
    expect(btn.textContent).toBe('Failed: No active run');
    expect(btn.disabled).toBe(true);
  });
});

describe('Human Input asks every project with orgs', () => {
  it('filters on hasOrgs instead of the 8 most recent projects', async () => {
    const projects = Array.from({ length: 12 }, (_, i) => ({
      path: `/p${i}`,
      name: `p${i}`,
      hasOrgs: i % 2 === 0,
    }));
    const asked: string[] = [];
    const el = { innerHTML: '' };
    const ctx = loadPageFunctions(dashboardScript, ['renderHumanInputView'], {
      DIR: '/p0',
      enc: encodeURIComponent,
      _hiEntries: [],
      document: { getElementById: () => el },
      apiFetch: async (u: string) => {
        if (u === '/api/projects') return { projects };
        asked.push(decodeURIComponent(u.split('dir=')[1]));
        return {};
      },
      _hiWhen: () => 0,
      _hiIsPending: () => true,
      updateHumanInputBadge: () => {},
      renderHiCurrentTab: () => {},
      baseName: (p: string) => p,
    });
    await ctx.renderHumanInputView();
    expect(asked).toEqual(['/p0', '/p2', '/p4', '/p6', '/p8', '/p10']);
  });

  describe('GET /api/projects', () => {
    let close: (() => void) | undefined;
    const dirs: string[] = [];
    afterEach(() => {
      close?.();
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });

    it('reports hasOrgs per project', async () => {
      const root = mkdtempSync(join(tmpdir(), 'dash-hasorgs-'));
      dirs.push(root);
      const withOrgs = join(root, 'withorgs');
      const without = join(root, 'without');
      mkdirSync(join(withOrgs, '.monomind', 'orgs'), { recursive: true });
      mkdirSync(join(without, '.monomind'), { recursive: true });
      for (const p of [withOrgs, without]) {
        const slugDir = join(homedir(), '.claude', 'projects', p.replace(/[/.]/g, '-'));
        mkdirSync(slugDir, { recursive: true });
        dirs.push(slugDir);
        writeFileSync(
          join(slugDir, 's.jsonl'),
          `${JSON.stringify({ type: 'user', cwd: p, sessionId: 's' })}\n`,
        );
      }
      const srv = await startServer({ port: 14781, projectDir: withOrgs, openBrowser: false });
      close = () => srv.server.close();
      const tokenFile = join(withOrgs, '.monomind', 'dashboard-token');
      for (let i = 0; i < 100 && !existsSync(tokenFile); i++) await tick(50);
      const res = await fetch(`http://127.0.0.1:${srv.port}/api/projects`, {
        headers: { 'x-monomind-token': readFileSync(tokenFile, 'utf8') },
      });
      const { projects } = (await res.json()) as { projects: { path: string; hasOrgs: boolean }[] };
      const byPath = Object.fromEntries(projects.map((p) => [p.path, p.hasOrgs]));
      expect(byPath[withOrgs]).toBe(true);
      expect(byPath[without]).toBe(false);
    }, 20000);
  });
});
