/**
 * Static integrity checks over the dashboard page's scripts, for two bug
 * classes that a regex over inline `on*=` attributes cannot see:
 *
 * - A call to a name no script declares. Commit 9537930fb renamed handlers to
 *   _-prefixed names; calls stored as data (the "N errors" alert's
 *   `action: 'jumpToErrors()'`) kept the old name and threw ReferenceError.
 * - An assignment to a top-level `const`. The same commit turned reassigned
 *   bindings into `const` because Biome's useConst lints each <script> block
 *   and never sees assignments from inline handlers or other blocks
 *   (Mastermind > Skills search threw a TypeError on every keystroke).
 *
 * The page's scripts are concatenated in load order (classic scripts share one
 * global scope) and linted by Biome's noUndeclaredVariables and noConstAssign
 * rules. Names a page publishes on `window` (`window.x = ...`, or a key of an
 * `Object.assign(window, {...})` block) count as declared. Inline handler code
 * is not valid JS on its own (it sits in template strings), so the two rules are
 * applied to it by hand: every `name=` in a handler must not target a top-level
 * const, and every `action: 'name()'` string that is later written into an
 * onclick attribute must name a callable global.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { definedGlobals, inlineScript, UI_DIR } from './dashboard-script.js';

const read = (f: string) => readFileSync(join(UI_DIR, f), 'utf-8');

/** Each page: the files it loads as classic scripts, in load order, and its markup sources. */
const PAGES = {
  'dashboard.html': {
    script: () => `${read('markdown.js')}\n${inlineScript('dashboard.html')}`,
    markup: () => read('dashboard.html'),
  },
} as const;

/** Globals the pages get from a CDN `<script src>`, not from their own scripts. */
const CDN_GLOBALS = ['gsap'];

const biomeBin = join(
  createRequire(import.meta.url).resolve('@biomejs/biome/package.json'),
  '..',
  'bin',
  'biome',
);

const work = mkdtempSync(join(tmpdir(), 'dash-integrity-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Finding {
  rule: 'undeclared' | 'const-assign';
  name: string;
  line: number;
}

/** Lints `src` with only the two rules; returns one finding per diagnostic. */
function lint(src: string, name = 'page.js'): Finding[] {
  writeFileSync(
    join(work, 'biome.json'),
    JSON.stringify({
      linter: {
        enabled: true,
        rules: {
          recommended: false,
          correctness: { noUndeclaredVariables: 'error', noConstAssign: 'error' },
        },
      },
      formatter: { enabled: false },
      assist: { enabled: false },
      javascript: { globals: CDN_GLOBALS },
    }),
  );
  writeFileSync(join(work, name), src);
  const r = spawnSync(
    biomeBin,
    ['lint', `--config-path=${work}`, '--max-diagnostics=none', '--reporter=json', name],
    { cwd: work, encoding: 'utf-8' },
  );
  const report = JSON.parse(r.stdout) as {
    diagnostics: {
      category: string;
      message?: string;
      description?: string;
      location: { start?: { line?: number } };
    }[];
  };
  const out: Finding[] = [];
  for (const d of report.diagnostics) {
    const text = d.message ?? d.description ?? '';
    const line = d.location.start?.line ?? 0;
    if (d.category.endsWith('noUndeclaredVariables')) {
      const m = /The (\S+) variable is undeclared/.exec(text);
      if (m) out.push({ rule: 'undeclared', name: m[1], line });
    } else if (d.category.endsWith('noConstAssign')) {
      const m = /assign (\S+) because/.exec(text);
      if (m) out.push({ rule: 'const-assign', name: m[1], line });
    } else if (d.category === 'parse') {
      throw new Error(`Biome could not parse ${name} at line ${line}: ${text}`);
    }
  }
  return out;
}

/** Biome findings, minus calls to names the page publishes on `window`. */
function scriptFindings(src: string): Finding[] {
  const published = definedGlobals(src);
  return lint(src).filter((f) => f.rule === 'const-assign' || !published.has(f.name));
}

/** Top-level (column 0) const bindings of a page script. */
function topLevelConsts(src: string): Set<string> {
  return new Set([...src.matchAll(/^const\s+([\w$]+)\s*=/gm)].map((m) => m[1]));
}

/** `name=` assignments inside inline `on*="..."` handlers that target a top-level const. */
function handlerConstAssignments(markup: string, consts: Set<string>): string[] {
  const hits: string[] = [];
  for (const [, code] of markup.matchAll(/\son[a-z]+="([^"]*)"/g)) {
    for (const [, name] of code.matchAll(/(?<![\w$.'])([A-Za-z_$][\w$]*)\s*=(?![=>])/g)) {
      if (consts.has(name)) hits.push(name);
    }
  }
  return hits;
}

/** Calls stored as `action: 'name(...)'` strings and later written into an onclick attribute. */
function actionStringCalls(markup: string): string[] {
  return [...markup.matchAll(/\baction:\s*'([A-Za-z_$][\w$]*)\(/g)].map((m) => m[1]);
}

const fmt = (fs: Finding[]) =>
  fs.map((f) => `${f.rule} ${f.name} (script line ${f.line})`).join(', ');

describe.each(Object.entries(PAGES))('%s scripts', (page, { script, markup }) => {
  const src = script();

  it('calls no undeclared name and assigns to no const', () => {
    const findings = scriptFindings(src);
    expect(findings, `${page}: ${fmt(findings)}`).toEqual([]);
  });

  it('inline handlers assign to no top-level const', () => {
    expect(handlerConstAssignments(markup(), topLevelConsts(src))).toEqual([]);
  });

  it("every action: 'fn()' string names a callable global", () => {
    const defined = definedGlobals(src);
    const missing = actionStringCalls(markup()).filter((n) => !defined.has(n));
    expect(missing).toEqual([]);
  });
});

describe('script integrity checks — negative controls', () => {
  it('flags a call to a name nothing declares', () => {
    const f = scriptFindings('function a() { renderFilesTab(); }\nfunction _renderFilesTab() {}\n');
    expect(f).toEqual([expect.objectContaining({ rule: 'undeclared', name: 'renderFilesTab' })]);
  });

  it('flags a reassigned top-level const', () => {
    const f = scriptFindings('const allOrgs = [];\nfunction load() { allOrgs = [1]; }\n');
    expect(f).toEqual([expect.objectContaining({ rule: 'const-assign', name: 'allOrgs' })]);
  });

  it('accepts a name published on window, and a CDN global', () => {
    const src =
      'window.openX = () => {};\nObject.assign(window, {\n  closeX: _closeX,\n});\nfunction _closeX() {}\nfunction a() { openX(); closeX(); gsap.to("#a", {}); }\n';
    expect(scriptFindings(src)).toEqual([]);
  });

  it('flags an inline handler assigning to a top-level const', () => {
    const consts = topLevelConsts("const _filter = '';\n");
    expect(handlerConstAssignments('<input oninput="_filter=this.value;go()">', consts)).toEqual([
      '_filter',
    ]);
    expect(handlerConstAssignments('<input oninput="x.y=1;a==b">', consts)).toEqual([]);
  });

  it("flags an action: 'fn()' string naming nothing", () => {
    expect(actionStringCalls("all.push({ id: 'e', action: 'jumpToErrors()' });")).toEqual([
      'jumpToErrors',
    ]);
  });
});

describe('dashboard.html — Mastermind skills search', () => {
  it('typing filters the list without replacing the search input', async () => {
    const { loadPageFunctions, dashboardScript } = await import('./dashboard-script.js');
    const els: Record<string, { innerHTML: string }> = {
      'mm-body': { innerHTML: '' },
      'mm-skill-list': { innerHTML: '' },
    };
    const ctx = loadPageFunctions(dashboardScript, ['mmRenderSkills', 'mmRenderSkillList', 'esc'], {
      _MM_SKILLS_CATALOG: [
        { name: 'mastermind:plan', desc: 'write a plan' },
        { name: 'mastermind:debug', desc: 'root cause' },
      ],
      _mmSkillFilter: '',
      document: { getElementById: (id: string) => els[id] },
    });
    ctx.mmRenderSkills(els['mm-body']);
    const shell = els['mm-body'].innerHTML;
    expect(shell).toContain('oninput="_mmSkillFilter=this.value;mmRenderSkillList()"');
    expect(els['mm-skill-list'].innerHTML).toContain('mastermind:debug');

    ctx._mmSkillFilter = 'plan'; // what the oninput handler does
    ctx.mmRenderSkillList();
    expect(els['mm-body'].innerHTML).toBe(shell); // the input was not re-rendered
    expect(els['mm-skill-list'].innerHTML).toContain('mastermind:plan');
    expect(els['mm-skill-list'].innerHTML).not.toContain('mastermind:debug');
  });
});
