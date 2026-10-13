/**
 * Dashboard review fixes: markdown sanitizer, cost-honesty flags, the
 * /mastermind page wiring, and the behavior of the dashboard.html / orgs.html
 * inline scripts (run in a vm with stubbed browser globals).
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calledFromHandlers,
  dashboardScript,
  definedGlobals,
  inlineScript,
  loadPageFunctions,
  UI_DIR,
} from './dashboard-script.js';

const read = (f: string) => readFileSync(join(UI_DIR, f), 'utf-8');

function loadMarkdown(): (md: string) => string {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(read('markdown.js'), ctx);
  return ctx.renderDocMarkdown as (md: string) => string;
}

describe('markdown.js sanitizer', () => {
  const render = loadMarkdown();

  it('does not pass raw HTML through as markup', () => {
    const out = render('<svg/onload=alert(1)>x</svg>');
    expect(out).not.toMatch(/<svg/i);
    expect(out).toContain('&lt;svg');
  });

  it('escapes raw HTML blocks containing script/handlers', () => {
    const out = render('<div onclick="x()">\nhi\n</div>');
    expect(out).not.toMatch(/<div onclick/i);
  });

  it.each([
    '<a href=" javascript:alert(1)">x</a>',
    "<a href='javascript:alert(1)'>x</a>",
    '<a href="\u0001javascript:alert(1)">x</a>',
  ])('never emits a live anchor for %j', (src) => {
    expect(render(src)).not.toMatch(/<a\s/i);
  });

  it.each([
    '[x]( javascript:alert(1))',
    '[x](\u0001javascript:alert(1))',
    '[x](java\tscript:alert(1))',
    '[x](JaVaScRiPt:alert(1))',
    '[x](data:text/html,hi)',
  ])('markdown link %j gets a neutral href', (src) => {
    const out = render(src);
    expect(out).not.toMatch(/href="[^"]*javascript/i);
    expect(out).not.toMatch(/href="data:/i);
  });

  it('keeps safe links and relative links', () => {
    expect(render('[a](https://example.com/x)')).toContain('href="https://example.com/x"');
    expect(render('[a](/docs/x)')).toContain('href="/docs/x"');
  });

  it('renders text containing CB<n>/HB<n> literally', () => {
    const out = render('Order ref CB7 and HB3');
    expect(out).toContain('Order ref CB7 and HB3');
  });

  it('does not confuse CB<n> text with a real code block placeholder', () => {
    const out = render('```js\nreal\n```\n\nsee CB0 here');
    expect(out).toContain('see CB0 here');
    expect(out.match(/gd-code-block/g)?.length).toBe(1);
  });

  it('does not italicize inside snake_case words', () => {
    const out = render('use my_var_name and _real_ emphasis');
    expect(out).toContain('my_var_name');
    expect(out).toContain('<em>real</em>');
  });
});

describe('collector cost flags', () => {
  it('flags unpriced models and keeps priced-only data complete', async () => {
    const { collectTokens } = await import('../ui/collector.mjs');
    const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dash-cost-'));
    try {
      const sessions = join(dir, '.claude', 'sessions');
      mkdirSync(sessions, { recursive: true });
      const ts = new Date().toISOString();
      const line = (model: string) =>
        JSON.stringify({
          type: 'assistant',
          timestamp: ts,
          message: { model, usage: { input_tokens: 1000, output_tokens: 1000 } },
        });
      writeFileSync(join(sessions, 'priced.jsonl'), `${line('claude-sonnet-4-5')}\n`);
      writeFileSync(join(sessions, 'unpriced.jsonl'), `${line('totally-new-model-9')}\n`);

      const out = collectTokens(dir);
      expect(out.summary.costIncomplete).toBe(true);
      expect(out.summary.unknownPricingModels).toEqual(['totally-new-model-9']);
      expect(out.summary.todayCostIncomplete).toBe(true);
      const byId = Object.fromEntries(out.rows.map((r: { id: string }) => [r.id, r]));
      expect(byId.unpriced.costIncomplete).toBe(true);
      expect(byId.unpriced.cost).toBe(0);
      expect(byId.priced.costIncomplete).toBe(false);
      expect(out.daily[out.daily.length - 1].costIncomplete).toBe(true);

      rmSync(join(sessions, 'unpriced.jsonl'));
      const clean = collectTokens(dir);
      expect(clean.summary.costIncomplete).toBe(false);
      expect(clean.summary.unknownPricingModels).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('/mastermind page wiring', () => {
  const route = read('routes-org-mastermind.mjs');
  const page = read('mastermind-diagram-fallback.html');

  it('injects the mm-token meta into /mastermind', () => {
    const seg = route.slice(route.indexOf("url === '/mastermind'"));
    expect(seg.slice(0, 900)).toContain('name="mm-token"');
  });

  it('artifact route decodes once and re-checks containment after realpath', () => {
    expect(route).not.toMatch(/decodeURIComponent\(_rawPath\)/);
    expect(route).toContain('realpathSync');
  });

  it('fallback page authenticates fetch and EventSource and escapes data', () => {
    expect(page).toContain('mm-token');
    expect(page).toContain('window.mmEventSource');
    expect(page).not.toMatch(/new EventSource\('\/api\/mastermind-stream'\)/);
    expect(page).toContain('function esc(');
    expect(page).not.toContain('<span class="log-msg">${msg}</span>');
    expect(page).not.toContain('<div class="sess-prompt">${s.prompt||');
    expect(page).toMatch(/if \(!res\.ok\) return;\s*const sessions/);
  });
});

/** A browser element stand-in that records what the page writes to it. */
const fakeEl = (extra: Record<string, unknown> = {}) => ({
  innerHTML: '',
  textContent: '',
  style: {},
  dataset: {},
  value: '',
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  ...extra,
});
const fakeDocument = (els: Record<string, ReturnType<typeof fakeEl>> = {}) => ({
  getElementById: (id: string) => els[id] ?? null,
});

describe('dashboard inline script behavior', () => {
  const dash = (names: string[] | 'all', globals: Record<string, unknown> = {}) =>
    loadPageFunctions(dashboardScript, names, globals);

  it('_ofMdToHtml applies a scheme allowlist to link and image URLs', () => {
    const { _ofMdToHtml } = dash(['_ofSafeUrl', '_ofMdTableRow', '_ofMdToHtml']);
    for (const bad of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'data:text/html,hi',
    ]) {
      expect(_ofMdToHtml(`[x](${bad})`), bad).toContain('<a href="#"');
      expect(_ofMdToHtml(`![x](${bad})`), bad).toContain('<img src="#"');
    }
    expect(_ofMdToHtml('[a](https://example.com/x)')).toContain('<a href="https://example.com/x"');
    expect(_ofMdToHtml('[a](/docs/x)')).toContain('<a href="/docs/x"');
  });

  it('fmtCost shows an unpriced total as unpriced and an incomplete one as a floor', () => {
    const { fmtCost } = dash(['fmtCost']);
    expect(fmtCost(1.234, false)).toBe('$1.23');
    expect(fmtCost(1.234, true)).toBe('≥$1.23');
    expect(fmtCost(0, true)).toBe('unpriced');
    expect(fmtCost(0, false)).toBe('$0.00');
    expect(fmtCost(2, false, 4)).toBe('$2.0000');
  });

  it('the project leaderboard renders unpriced and floor costs, never a fabricated $0.00', async () => {
    const body = fakeEl();
    const { loadProjCosts } = dash(['loadProjCosts', 'fmtCost', 'esc'], {
      document: fakeDocument({ 'proj-costs-body': body }),
      apiFetch: async () => ({
        projects: [
          { path: '/p/priced', cost: 3, costIncomplete: false },
          { path: '/p/floor', cost: 1.5, costIncomplete: true, unknownPricingModels: ['m-9'] },
          { path: '/p/unpriced', cost: 0, costIncomplete: true, unknownPricingModels: ['m-10'] },
        ],
      }),
    });
    await loadProjCosts();
    expect(body.innerHTML).toContain('>$3.00</td>');
    expect(body.innerHTML).toContain('>≥$1.50</td>');
    expect(body.innerHTML).toContain('>unpriced</td>');
    expect(body.innerHTML).toContain('Unpriced models: m-10');
    expect(body.innerHTML).not.toContain('>$0.00</td>');
  });

  it("today's cost badge uses the incomplete flag", async () => {
    const badge = fakeEl();
    const { loadTodayMetrics } = dash(['loadTodayMetrics', 'fmtCost', 'esc', 'enc'], {
      DIR: '/p',
      alertState: {},
      updateAlerts() {},
      checkBudget() {},
      document: fakeDocument({ 'topbar-cost': badge }),
      apiFetch: async () => ({
        tokens: { summary: { todayCost: 2.5, todayCostIncomplete: true, todayCalls: 3 } },
      }),
    });
    await loadTodayMetrics().catch(() => {}); // the rest of the strip needs more of the page than is stubbed
    expect(badge.textContent).toBe('≥$2.50 today');
  });

  it('the org runtime view carries the cost lower-bound flags into the budget line and role rows', async () => {
    const el = fakeEl({ dataset: {} });
    const ctx = dash('all', {
      document: fakeDocument({ 'odt-runtime': el }),
      _v2SelOrg: 'acme',
      _v2RuntimeTimer: null,
      _v2OrgTab: 'runtime',
      DIR: '',
      _RT_CLOSED_BY: {},
      fetch: async () => ({
        ok: true,
        json: async () => ({
          valid: true,
          live: false,
          status: 'done',
          run: 'run-1',
          settings: {},
          budget: { basis: 'total', tokens: 1000, used: 10 },
          totals: { cost_usd: 1.25, costLowerBound: true },
          roles: [
            {
              id: 'a',
              title: 'A',
              runtime: 'claude',
              usage: { cost_usd: 0.5, costComplete: false },
            },
            {
              id: 'b',
              title: 'B',
              runtime: 'claude',
              usage: { cost_usd: 0.75, costComplete: true },
            },
          ],
        }),
      }),
    });
    await ctx.v2RenderOrgRuntime();
    expect(el.innerHTML).toContain('≥$1.25');
    expect(el.innerHTML).toContain('≥$0.50');
    expect(el.innerHTML).toContain('$0.75');
    expect(el.innerHTML).not.toContain('≥$0.75');
  });

  it('onclick payloads are HTML-escaped: a quote in an id cannot break out of the attribute', () => {
    const { esc } = dash(['esc']);
    const payload = `x") ;alert(1);//"`;
    const attr = `onclick="pbLoadDef(${esc(JSON.stringify(payload))})"`;
    // The attribute still has exactly its two delimiting quotes, so the handler cannot be closed early.
    expect(attr.match(/"/g)?.length).toBe(2);
    expect(attr).toContain('&quot;');
  });

  it('apiFetch tells the user when run history was served truncated', async () => {
    const toasts: unknown[][] = [];
    const reply = (headers: Record<string, string>) => async () => ({
      ok: true,
      headers: { get: (k: string) => headers[k] ?? null },
      json: async () => ({ ok: 1 }),
    });
    const run = async (headers: Record<string, string>) => {
      toasts.length = 0;
      const { apiFetch } = dash(['apiFetch'], {
        fetch: reply(headers),
        showToast: (...a: unknown[]) => toasts.push(a),
      });
      return apiFetch('/api/x');
    };
    expect(await run({ 'X-Events-Offset': '40', 'X-Total-Events': '540' })).toEqual({ ok: 1 });
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe('Run history truncated');
    expect(String(toasts[0][1])).toContain('40 earlier events');
    await run({});
    expect(toasts).toHaveLength(0);
    await run({ 'X-Events-Offset': '0' });
    expect(toasts).toHaveLength(0);
  });

  it('dashboard no longer reads the nonexistent swarm topology or wiki-search route', () => {
    // Absence checks have no behavior to run: the removed code is simply not in the page.
    const dashSrc = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
    expect(dashSrc).not.toContain('_appSwarmTopo');
    expect(dashSrc).not.toMatch(/apiFetch\(`\/api\/monograph-wiki-search/);
  });

  it('command palette lists only commands that have files', () => {
    const dashSrc = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
    const cmds = join(UI_DIR, '../../../../../.claude/commands');
    const names = [...dashSrc.matchAll(/'\/((?:mastermind|github):[a-z-]+)(?: --[a-z-]+)*'/g)].map(
      (m) => m[1],
    );
    expect(names.length).toBeGreaterThan(10);
    for (const n of names) {
      const [dir, file] = n.split(':');
      let ok = true;
      try {
        readFileSync(join(cmds, dir, `${file}.md`));
      } catch {
        ok = false;
      }
      expect(ok, n).toBe(true);
    }
  });
});

describe('inline handlers call functions the page defines', () => {
  // `function`/`if` come from handler bodies like onclick="if (...) fn()", `String` from onclick="x(String(i))".
  const language = new Set(['String', 'function', 'if']);

  it('every function called from an on*="..." attribute of dashboard.html exists, including Rebuild Graph', () => {
    const html = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
    const defined = definedGlobals(html);
    const missing = [...calledFromHandlers(html)].filter(
      (f) => !language.has(f) && !defined.has(f),
    );
    expect(missing).toEqual([]);
    expect(html).toMatch(/onclick="_?mgRebuildGraph\(\)"/); // the button exists, so the check above covers it
  });

  it('every function called from an on*="..." attribute of orgs.html exists', () => {
    const html = readFileSync(join(UI_DIR, 'orgs.html'), 'utf-8');
    const defined = definedGlobals(
      `${html}\n${readFileSync(join(UI_DIR, 'orgs-files.js'), 'utf-8')}`,
    );
    const missing = [...calledFromHandlers(html)].filter(
      (f) => !language.has(f) && !defined.has(f),
    );
    expect(missing).toEqual([]);
  });

  it('orgs-files.js onclick payloads are HTML-escaped (openDiffPanel / viewArtifact)', () => {
    // Source text: the file's renderer needs the whole orgs.html page state (chatSessions, esc, ...) to run.
    const orgFiles = readFileSync(join(UI_DIR, 'orgs-files.js'), 'utf-8');
    expect(orgFiles).toContain('openDiffPanel(${esc(JSON.stringify(art.path))})');
    expect(orgFiles).toContain('viewArtifact(${esc(JSON.stringify(art.path))}');
  });
});

describe('orgs.html behavior', () => {
  const orgsScript = inlineScript('orgs.html');
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const setTimeoutStub = (fn: () => void, ms: number) => timers.push({ fn, ms });
  beforeEach(() => {
    timers.length = 0;
  });

  function fakeSources() {
    const made: Array<{ closed: number; onerror?: () => void; close(): void }> = [];
    const mmEventSource = () => {
      const src = {
        closed: 0,
        onerror: undefined as undefined | (() => void),
        close() {
          src.closed++;
        },
      };
      made.push(src);
      return src;
    };
    return { made, mmEventSource };
  }

  it('the mastermind SSE error handler closes the source and schedules one reconnect', () => {
    const { made, mmEventSource } = fakeSources();
    const ctx = loadPageFunctions(orgsScript, ['connectMmSSE'], {
      mmSse: null,
      mmReconnectTimer: null,
      window: { mmEventSource },
      document: fakeDocument(),
      setTimeout: setTimeoutStub,
    });
    ctx.connectMmSSE();
    expect(made).toHaveLength(1);
    made[0].onerror?.();
    made[0].onerror?.(); // a second error before the retry fires must not stack another timer
    expect(made[0].closed).toBe(1);
    expect(timers).toHaveLength(1);
    timers[0].fn();
    expect(made).toHaveLength(2); // the retry opened a fresh source
  });

  it('the org activity SSE error handler closes the source and schedules one reconnect', () => {
    const { made, mmEventSource } = fakeSources();
    const ctx = loadPageFunctions(orgsScript, ['connectSSE'], {
      evtSource: null,
      sseReconnectTimer: null,
      window: { mmEventSource },
      setTimeout: setTimeoutStub,
    });
    ctx.connectSSE();
    made[0].onerror?.();
    made[0].onerror?.();
    expect(made[0].closed).toBe(1);
    expect(timers).toHaveLength(1);
    timers[0].fn();
    expect(made).toHaveLength(2);
  });

  it('the live feed escapes event text', () => {
    const rows = {
      ...fakeEl(),
      children: [] as unknown[],
      appendChild(r: unknown) {
        rows.children.push(r);
      },
      scrollTop: 0,
      scrollHeight: 0,
    };
    const created: Array<Record<string, any>> = [];
    const ctx = loadPageFunctions(orgsScript, ['appendLiveFeedRow', 'esc'], {
      document: {
        getElementById: () => rows,
        createElement: () => {
          const el = { className: '', title: '', innerHTML: '' };
          created.push(el);
          return el;
        },
      },
    });
    ctx.appendLiveFeedRow({ type: 'org:note', message: '<img src=x onerror=alert(1)>' }, true);
    expect(created[0].innerHTML).toContain(
      '<span class="clf-msg">&lt;img src=x onerror=alert(1)&gt;</span>',
    );
    expect(created[0].innerHTML).not.toContain('<img');
  });

  it('the org list keeps the previous orgs when /api/orgs fails or answers a non-array', async () => {
    for (const reply of [
      { ok: false, status: 503, json: async () => ({ error: 'down' }) },
      { ok: true, json: async () => ({ not: 'a list' }) },
    ]) {
      let rendered = 0;
      const ctx = loadPageFunctions(orgsScript, ['loadOrgs'], {
        allOrgs: [{ name: 'keep' }],
        selectedOrg: null,
        orgDetailData: null,
        renderSidebar: () => rendered++,
        fetch: async () => reply,
      });
      await ctx.loadOrgs();
      expect(ctx.allOrgs).toEqual([{ name: 'keep' }]);
      expect(rendered).toBe(1);
    }
    const ctx = loadPageFunctions(orgsScript, ['loadOrgs'], {
      allOrgs: [],
      selectedOrg: null,
      renderSidebar() {},
      fetch: async () => ({ ok: true, json: async () => [{ name: 'fresh' }] }),
    });
    await ctx.loadOrgs();
    expect(ctx.allOrgs).toEqual([{ name: 'fresh' }]);
  });
});

describe('review follow-ups', () => {
  it('the heartbeat only evicts the run runtime.json still records as running', async () => {
    const { activeOrgRuns } = await import('../ui/server-rundb.mjs');
    const { setupServerLifecycle } = await import('../ui/server-lifecycle.mjs' as string);
    const home = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dash-hb-'));
    const DEAD_PID = 2 ** 31 - 2; // no such process
    const writeRt = (rt: Record<string, unknown>) => {
      mkdirSync(join(home, '.monomind', 'orgs', 'hb'), { recursive: true });
      writeFileSync(join(home, '.monomind', 'orgs', 'hb', 'runtime.json'), JSON.stringify(rt));
    };
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { stopBackgroundTasks } = setupServerLifecycle({
      projectDir: home,
      MONOMIND_HOME: home,
      boundPort: 1,
      dashboardAuthValue: 't',
    });
    const beat = () => vi.advanceTimersByTime(60_000);
    try {
      // A newer run has not rewritten runtime.json yet: the record names another run, so keep ours.
      activeOrgRuns.set('hb', 'run-1');
      writeRt({ run: 'run-2', status: 'running', pid: DEAD_PID });
      beat();
      expect(activeOrgRuns.get('hb')).toBe('run-1');
      // The record is not "running": not ours to judge either.
      writeRt({ run: 'run-1', status: 'done', pid: DEAD_PID });
      beat();
      expect(activeOrgRuns.get('hb')).toBe('run-1');
      // The recorded running run's pid is gone: evicted.
      writeRt({ run: 'run-1', status: 'running', pid: DEAD_PID });
      beat();
      expect(activeOrgRuns.has('hb')).toBe(false);
      // A live pid stays.
      activeOrgRuns.set('hb', 'run-1');
      writeRt({ run: 'run-1', status: 'running', pid: process.pid });
      beat();
      expect(activeOrgRuns.get('hb')).toBe('run-1');
    } finally {
      activeOrgRuns.delete('hb');
      stopBackgroundTasks();
      vi.useRealTimers();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
