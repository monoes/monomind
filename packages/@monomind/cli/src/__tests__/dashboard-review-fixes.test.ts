/**
 * Dashboard review fixes: markdown sanitizer, cost-honesty flags, and static
 * wiring checks for the /mastermind page and orgs.html.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '../ui');
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

describe('dashboard / orgs static fixes', () => {
  const dash = read('dashboard.html');
  const orgs = read('orgs.html');
  const orgFiles = read('orgs-files.js');

  it('_ofMdToHtml applies a scheme allowlist to link and image URLs', () => {
    expect(dash).toContain('function _ofSafeUrl');
    expect(dash).toMatch(/<a href="\$\{_ofSafeUrl\(url\)/);
    expect(dash).toMatch(/<img src="\$\{_ofSafeUrl\(url\)/);
  });

  it('cost sites render through fmtCost with incomplete flags', () => {
    expect(dash).toContain('fmtCost(s.todayCost, s.todayCostIncomplete)');
    expect(dash).toContain('fmtCost(p.cost, p.costIncomplete)');
    expect(dash).not.toContain('<td class="lb-cost">$${p.cost.toFixed(2)}</td>');
  });

  it('onclick payloads are HTML-escaped', () => {
    expect(dash).toContain('pbLoadDef(${esc(JSON.stringify(d.id))})');
    expect(orgFiles).toContain('openDiffPanel(${esc(JSON.stringify(art.path))})');
    expect(orgFiles).toContain('viewArtifact(${esc(JSON.stringify(art.path))}');
  });

  it('orgs.html SSE error handlers close the source and guard timers', () => {
    expect(orgs).toContain('mmReconnectTimer');
    expect(orgs).toContain('sseReconnectTimer');
    expect(orgs).toMatch(/if \(src\) src\.close\(\);/);
    expect(orgs).toContain('<span class="clf-msg">${esc(msg)}</span>');
    expect(orgs).toContain('if (!r.ok) throw new Error(`HTTP ${r.status}`)');
  });

  it('dashboard no longer reads the nonexistent swarm topology or wiki-search route', () => {
    expect(dash).not.toContain('_appSwarmTopo');
    expect(dash).not.toMatch(/apiFetch\(`\/api\/monograph-wiki-search/);
  });

  it('command palette lists only commands that have files', () => {
    const cmds = join(UI_DIR, '../../../../../.claude/commands');
    const names = [...dash.matchAll(/'\/((?:mastermind|github):[a-z-]+)(?: --[a-z-]+)*'/g)].map(
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

describe('review follow-ups', () => {
  it('the Rebuild Graph button calls a function that exists', () => {
    const html = read('dashboard.html');
    const m = html.match(/onclick="(_?mgRebuildGraph)\(\)"/);
    expect(m).toBeTruthy();
    expect(html).toMatch(new RegExp(`function ${m?.[1]}\\(`));
  });

  it('apiFetch tells the user when run history was served truncated', () => {
    expect(read('dashboard.html')).toMatch(/X-Events-Offset[\s\S]{0,200}Run history truncated/);
  });

  it('the heartbeat only evicts the run runtime.json still records as running', () => {
    expect(read('server-lifecycle.mjs')).toMatch(/_hbRt\.status !== 'running'/);
  });

  it('cost lower-bound flags reach the org runtime view', () => {
    const html = read('dashboard.html');
    expect(html).toContain('fmtCost(v.totals.cost_usd, v.totals.costLowerBound)');
    expect(html).toContain('r.usage.costComplete === false');
  });
});
