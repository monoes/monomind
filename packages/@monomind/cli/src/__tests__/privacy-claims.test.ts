// i-078 — the privacy claim on npm (and in every user's own generated
// .agents/shared_instructions.md) is false. package.json (root) says "runs
// locally, no data leaves your machine"; packages/@monomind/cli/package.json
// says "fully local"; doc/getting-started.md says the embedding download is
// "the only outbound request monomind ever makes" two bullets after telling
// the user to run `doctor`, which itself makes a request; doc/llms.txt says
// "No user data ... leaves the machine". None of that is true: update
// checks, `doctor`, crash reporting (consent-gated) and monoes.me connect
// all make real requests. This pins: no unscoped instance of those claims
// survives anywhere in the tree; both package descriptions name the same
// platform set the README documents; a single canonical table exists and is
// linked from every fixed site; and the two claims that ARE true and
// Second-Brain-scoped (README.md — "Your notes never leave your computer" /
// "the only outbound request the Second Brain ever makes") are untouched.

import { execFileSync } from 'node:child_process';
import {
  type Dirent,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { writeSharedInstructions } from '../init/shared-instructions-generator.js';
import { detectPlatform, type InitResult } from '../init/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');

// The four historically-false phrasings, case-insensitive. Deliberately NOT
// matching README.md's true Second-Brain phrasings ("Your notes never leave
// your computer", "the only outbound request the Second Brain ever makes")
// — those use different wording entirely. The sentence-level scoping check
// below is a second, independent guard against future wording drift, per
// the plan: encode the allowance as "the match sits in a Second-Brain-scoped
// sentence", not a line-number allowlist.
const FORBIDDEN =
  /no data leaves your machine|fully local|only outbound request .*? monomind ever makes|no user data .*? leaves the machine/gi;

const PACKAGE_JSON_FILES = [
  'package.json',
  'packages/monofence-ai/package.json',
  'packages/@monoes/monobrowse/package.json',
  'packages/@monoes/monodesign/package.json',
  'packages/@monomind/cli/package.json',
  'packages/@monomind/hooks/package.json',
  'packages/@monomind/mcp/package.json',
  'packages/@monomind/memory/package.json',
  'packages/@monomind/monograph/package.json',
  'packages/@monomind/routing/package.json',
];

function listDocFiles(): string[] {
  const files: string[] = ['doc/llms.txt'];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
      const rel = join(dir, entry.name);
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) files.push(rel);
    }
  };
  walk('doc');
  files.push('README.md');
  return files;
}

/** The sentence (bounded by '. ', newline, or string edges) containing `index`. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('.', index), text.lastIndexOf('\n', index)) + 1;
  const endDot = text.indexOf('. ', index);
  const endNewline = text.indexOf('\n', index);
  const candidates = [endDot, endNewline].filter((n) => n !== -1);
  const end = candidates.length ? Math.min(...candidates) : text.length;
  return text.slice(start, end);
}

/** Forbidden-phrase matches whose containing sentence does NOT mention the
 * Second Brain — the only allowed exception, and it's checked by content,
 * not by file/line. */
function unscopedMatches(text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(FORBIDDEN)) {
    const sentence = sentenceAround(text, m.index ?? 0);
    if (!/second brain/i.test(sentence)) hits.push(m[0]);
  }
  return hits;
}

describe('privacy-claims (i-078)', () => {
  describe('§1 — no unscoped absolute privacy claim survives', () => {
    it.each(PACKAGE_JSON_FILES)('%s has no unscoped forbidden phrase', (relPath) => {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(unscopedMatches(text)).toEqual([]);
    });

    it.each(listDocFiles())('%s has no unscoped forbidden phrase', (relPath) => {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(unscopedMatches(text)).toEqual([]);
    });

    it('.agents/shared_instructions.md (committed, dogfooded) has no unscoped forbidden phrase', () => {
      const text = readFileSync(join(REPO_ROOT, '.agents', 'shared_instructions.md'), 'utf-8');
      expect(unscopedMatches(text)).toEqual([]);
    });
  });

  describe('§2 — .agents/shared_instructions.md regenerates clean from the real generator', () => {
    let tmp: string;

    afterEach(() => {
      rmSync(tmp, { recursive: true, force: true });
    });

    it('carries the fixed root package.json description verbatim, with no forbidden phrase', () => {
      // shared-instructions-generator.ts's detectProjectProfile() reads
      // *the target project's own* package.json description and copies it
      // verbatim into "Project Overview" — that pass-through is not itself
      // buggy (confirmed by reading it: no monomind-specific fallback text
      // exists anywhere in the file). The false claim in the committed
      // .agents/shared_instructions.md came from this repo's own (now
      // fixed) root package.json description being dogfooded through that
      // same pass-through. Proven here by feeding it the real, current
      // root description rather than hand-writing a fixture that could
      // drift from it.
      tmp = mkdtempSync(join(tmpdir(), 'monomind-shared-instructions-'));
      const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));
      writeFileSync(
        join(tmp, 'package.json'),
        JSON.stringify({ name: 'scratch', description: rootPkg.description }, null, 2),
      );

      const result: InitResult = {
        success: true,
        platform: detectPlatform(),
        created: { directories: [], files: [] },
        updated: [],
        skipped: [],
        errors: [],
        summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
      };
      writeSharedInstructions(tmp, true, result);
      const generated = readFileSync(join(tmp, '.agents', 'shared_instructions.md'), 'utf-8');

      expect(generated).toContain(rootPkg.description);
      expect(unscopedMatches(generated)).toEqual([]);
    });
  });

  describe('§2 — package descriptions agree with the README platform list', () => {
    it('derives the platform set from README.md and checks both package descriptions', () => {
      const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf-8');
      // README.md:33 — "plugs into Claude Code, OpenCode, Antigravity, Kimi
      // Code, and Codex via the standard Model Context Protocol". Extract
      // the platform names between "plugs into" and "via the standard" so
      // this test breaks (loudly, not silently) if that sentence changes
      // shape rather than silently checking against a stale retyped list.
      const platformSentence = readme.match(/plugs into ([\s\S]*?) via the standard/);
      expect(platformSentence, 'README platform-list sentence must still exist').not.toBeNull();
      // Markdown links (`[OpenCode](https://opencode.ai)`) collapse to their
      // link text before extracting names, so a linked platform isn't missed.
      const plainText = (platformSentence?.[1] ?? '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
      const names = [...plainText.matchAll(/([A-Z][A-Za-z ]+?)(?:,|\)| and|$)/g)]
        .map((m) => m[1].trim())
        .filter(Boolean);
      expect(names.length).toBeGreaterThanOrEqual(5);

      const rootDesc = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'))
        .description as string;
      const cliDesc = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages/@monomind/cli/package.json'), 'utf-8'),
      ).description as string;

      for (const name of names) {
        expect(rootDesc, `root package.json should name "${name}"`).toContain(name);
        expect(cliDesc, `cli package.json should name "${name}"`).toContain(name);
      }
    });
  });

  describe('§3 — the canonical outbound table exists and is linked', () => {
    it('doc/privacy.md exists with a Trigger/Destination/When/Opt-out table', () => {
      const table = readFileSync(join(REPO_ROOT, 'doc', 'privacy.md'), 'utf-8');
      expect(table).toMatch(/\|\s*Trigger\s*\|\s*Destination\s*\|\s*When\s*\|\s*Opt-out\s*\|/i);
      // At least the plan's five-row floor.
      const dataRows = table
        .split('\n')
        .filter(
          (l) => /^\|.*\|.*\|.*\|.*\|$/.test(l) && !/^\|\s*-+\s*\|/.test(l) && !/Trigger/.test(l),
        );
      expect(dataRows.length).toBeGreaterThanOrEqual(5);
    });

    it.each([
      ['doc/getting-started.md', 'doc/getting-started.md'],
      ['doc/llms.txt', 'doc/llms.txt'],
    ])('%s links to privacy.md', (_label, relPath) => {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(text).toMatch(/privacy\.md/);
    });

    // i-078 revision 2 (verifier MINOR 4): npm renders package.json's
    // `description` as plain text from a tarball that never ships doc/ — a
    // bare `doc/privacy.md` reference is unreachable there (MAJOR 2, fixed
    // in revision 1). `toMatch(/privacy\.md/)` alone can't tell the fixed
    // value from the old broken one — the old bare-path value satisfies it
    // too. Pin what was actually wrong: the absolute, tarball-independent
    // URL must be present, not just some substring containing "privacy.md".
    it.each([
      ['package.json', 'package.json'],
      ['packages/@monomind/cli/package.json', 'packages/@monomind/cli/package.json'],
    ])('%s points at the absolute GitHub URL, not a bare doc/ path', (_label, relPath) => {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(text).toMatch(/https:\/\/github\.com\/monoes\/monomind\/blob\/main\/doc\/privacy\.md/);
    });

    it('the fallow.cloud and monograph.dev verdicts are both written down', () => {
      const table = readFileSync(join(REPO_ROOT, 'doc', 'privacy.md'), 'utf-8');
      expect(table).toMatch(/fallow\.cloud/i);
      expect(table).toMatch(/i-097/);
      expect(table).toMatch(/monograph\.dev/i);
    });
  });

  // §3b (i-078 revision 3 — INVERTED per dev-lead's design; supersedes the
  // call-site walker from revisions 1-2). Each prior round closed one named
  // call-syntax shape and left an adjacent one open — "find every outbound
  // call" requires understanding call syntax, which is unbounded. INVERTED
  // CLAIM: instead of finding calls and checking they're documented, assert
  // that every external host appearing ANYWHERE in shipped source — in a
  // fetch(), a <script src>, or a comment — is CLASSIFIED below (a table
  // row, a verdict, or a reviewed-hosts entry with a reason). Deliberately
  // NOT "every host is an outbound request": `gexf.net`,
  // `graphml.graphdrawing.org` are XML namespace URIs, `raw.githubusercontent.com`
  // is a SARIF $schema, `www.apple.com` is a launchd plist DOCTYPE — none of
  // those are requests, and forcing a false table row for a namespace URI
  // (or silently dropping it) is the same failure this lane exists to fix.
  //
  // SCOPE (stated, not implicit — an inventory that doesn't say what it
  // counts has the o-09 overclaiming shape): covers literal `https?://`
  // hosts in files that SHIP AND (EXECUTE OR are SERVED to a client) —
  // .ts/.mjs/.js (execute) and .html/.svg (served/rendered). It deliberately
  // EXCLUDES: test fixtures (`__tests__/`, `*.test.ts` — SSRF-guard and
  // browser-adapter test data includes deliberate attack hosts like
  // `169.254.169.254`/`metadata.google.internal`, which do not belong in a
  // privacy inventory at all); top-level project docs (README.md, doc/**);
  // and in-`src` reference documentation (.md files ship as package content
  // but are neither executed nor served as a page — a design-system
  // citation link is not a request monomind makes). Measured on this tree:
  // 66 distinct external hosts. Reconciled against dev-lead's independent
  // 82-host count (full method: $RUN/logs/reviewer/i-078-host-set-
  // reconciliation.log): extensions explained 2 of the gap, excluding
  // `__tests__` explained the other 23 (attack fixtures, correctly
  // excluded) — and the residual gap ran the OTHER way, since this scan's
  // `files`-derived roots include `scripts/`, which the reviewer's literal
  // `src`-only glob missed entirely (that's understand-analyze.mjs's LIVE
  // api.anthropic.com call, finding 1's sibling). 66 stands.
  //
  // STATED LIMIT (required, not optional — same remedy as o-09's
  // overclaiming check name): this does NOT and CANNOT close non-literal
  // hosts. `'https://' + host` and `` `https://${host}` `` produce no
  // literal substring, so a runtime-assembled destination is invisible to
  // ANY static scanner, this one included. `orgrt/endpoint-roles.ts` and
  // `monograph/src/security/safe-fetch.ts` legitimately have no literal
  // host — the destination is user-supplied — so a blanket "every
  // network-touching file must have a literal host" rule would
  // false-positive on exactly those legitimate cases and is deliberately
  // not added.
  describe('§3b — every external host in shipped source is classified (row, verdict, or reviewed exclusion)', () => {
    const PACKAGE_DIRS = [
      'packages/monofence-ai',
      'packages/@monoes/monobrowse',
      'packages/@monoes/monodesign',
      'packages/@monomind/cli',
      'packages/@monomind/hooks',
      'packages/@monomind/mcp',
      'packages/@monomind/memory',
      'packages/@monomind/monograph',
      'packages/@monomind/routing',
    ];

    // Executes (.ts/.mjs/.js) or is served/rendered (.html/.svg) — the SCOPE
    // paragraph above this describe block states the full rule and why
    // .md/.json/.yaml/.sh/.cjs are excluded. (.json/.yaml/.sh/.cjs: measured
    // zero literal hosts anywhere in today's shipped surface either way.)
    const SCAN_EXTENSIONS = ['.ts', '.mjs', '.js', '.html', '.svg'];

    /** Every source root a package actually SHIPS — see §3b's sibling
     * function of the same name (removed from this file in this revision,
     * this is its direct descendant): derived from package.json `files`,
     * always including `src`. */
    function shippedSourceRoots(pkgRelDir: string): string[] {
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, pkgRelDir, 'package.json'), 'utf-8')) as {
        files?: string[];
      };
      const roots = new Set<string>(['src']);
      for (const entry of pkg.files ?? []) {
        if (entry.startsWith('!')) continue; // negation glob
        const name = entry.replace(/\/(\*\*)?$/, '');
        if (name === 'dist' || name === '.claude' || /\.[a-z]+$/i.test(name)) continue;
        roots.add(name);
      }
      return [...roots]
        .map((r) => join(pkgRelDir, r))
        .filter(
          (r) => existsSync(join(REPO_ROOT, r)) && statSync(join(REPO_ROOT, r)).isDirectory(),
        );
    }
    const SCAN_ROOTS = PACKAGE_DIRS.flatMap(shippedSourceRoots);

    const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g;
    const LOOPBACK_LIKE = (h: string): boolean =>
      h === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(h);

    /** Every non-test file of a scanned extension under every shipped
     * root, walked fresh at test time — not a hand-maintained list, which
     * is what lets this go red when a new file of a new host shows up
     * anywhere, in any of the scanned shapes. */
    function findAllExternalHosts(): Map<string, string[]> {
      const hostToFiles = new Map<string, string[]>();
      const walk = (dir: string): void => {
        let entries: Dirent[];
        try {
          entries = readdirSync(join(REPO_ROOT, dir), { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const rel = join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            walk(rel);
          } else if (
            SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
            !entry.name.endsWith('.test.ts')
          ) {
            const text = readFileSync(join(REPO_ROOT, rel), 'utf-8');
            for (const m of text.matchAll(HOST)) {
              // Strip trailing dot(s): a URL at the end of a JSDoc/comment
              // sentence ("...requests are relayed to, e.g. https://x.com.")
              // captures the sentence's full stop as part of the host, and
              // a bare "https://..." example placeholder captures nothing
              // but dots — both are punctuation/placeholder artifacts, not
              // part of any real hostname, and normalizing them here means
              // the reviewed set only needs the real host once.
              const host = m[1].toLowerCase().replace(/\.+$/, '');
              if (!host || LOOPBACK_LIKE(host)) continue;
              const files = hostToFiles.get(host) ?? [];
              if (!files.includes(rel)) files.push(rel);
              hostToFiles.set(host, files);
            }
          }
        }
      };
      for (const root of SCAN_ROOTS) walk(root);
      return hostToFiles;
    }

    // The reviewed set: every external host expected to appear ANYWHERE in
    // shipped source, one line each, grouped by why it's there. This
    // REPLACES the file-keyed exclusion list from revisions 1-2 — a single
    // flat set of hosts is what the inversion needs, and it is both
    // shorter and cannot develop the file-granularity blind spot that
    // motivated the inversion in the first place (a new host in an
    // already-reviewed FILE is just as visible as a new host in a brand
    // new one, because review happens per-host, not per-file).
    const REVIEWED_HOSTS = new Set<string>([
      // doc/privacy.md table rows.
      'registry.npmjs.org', // startup update check, `doctor` version freshness
      'api.github.com', // `doctor` companion-tool freshness, crash report, gist-publisher
      'services.nvd.nist.gov', // `security cve` primary
      'api.osv.dev', // `security cve` fallback
      'monoes.me', // monoes.me connect
      'huggingface.co', // embedding/reranker model download
      'sql.js.org', // sql.js WASM fallback
      'fonts.googleapis.com', // dashboard / Monograph HTML CDN row
      'unpkg.com', // dashboard / Monograph HTML CDN row
      'cdnjs.cloudflare.com', // dashboard / Monograph HTML CDN row
      'cdn.jsdelivr.net', // dashboard / Monograph HTML CDN row (this revision's finding 1)
      // doc/privacy.md dead-code verdicts.
      'api.fallow.cloud',
      'monograph.dev', // JSON Schema $id/$schema convention, not fetched
      'api.anthropic.com', // sampling.ts verdict (dead) AND understand-analyze.mjs (LIVE row)
      'api.openai.com', // wiki/providers.ts verdict
      'github.com', // monodesign context.mjs verdict (github.com/monoes/monomind, dead) — also
      // the printed docs URL, an OAuth provider preset default, and a source-attribution
      // comment; see the individual entries below for each of those uses.
      // "What's not in this table, on purpose" bullets — provider presets,
      // distributed-org coordination, and user-explicit-target commands.
      'accounts.google.com', // oauth.ts Google OAuth preset default
      'oauth2.googleapis.com', // oauth.ts Google OAuth preset default
      'login.microsoftonline.com', // monobrowse Microsoft/Teams login-flow adapter (browse)
      'api.z.ai', // vercel-providers.ts z.ai provider preset default
      'api.example.com', // orgrt/types.ts JSDoc example + dashboard.html webhook-config placeholder text
      // Printed-only install/doc hints (`doctor`/`init`/platform docs print a plain URL,
      // never fetched) and source-attribution / "further reading" comments.
      'nodejs.org',
      'aider.chat',
      'git-scm.com',
      'docs.github.com',
      'cli.github.com',
      'docs.npmjs.com',
      'code.visualstudio.com',
      'code.claude.com',
      'cursor.com',
      'opencode.ai',
      'antigravity.google',
      'gemini.google.com',
      'kiro.dev',
      'docs.factory.ai',
      'docs.x.ai',
      'docs.openclaw.ai',
      'hermes-agent.nousresearch.com',
      'qwenlm.github.io',
      'www.kimi.com',
      'learn.chatgpt.com',
      'developers.openai.com', // hook-lib.mjs comment citing OpenAI's Codex hooks doc
      'www.sonarsource.com',
      'fallow.dev',
      'docs.fallow.tools',
      'raw.githubusercontent.com', // SARIF $schema string, not fetched (i-078 revision 1 Q3)
      'arxiv.org', // citation comments (i-078 revision 1 Q3)
      'en.wikipedia.org', // graph/explain.ts "further reading" doc link, printed not fetched
      // Browser-automation login-flow adapters (`monomind browse <url>`) —
      // recognize specific sites so automation can handle their auth forms.
      'www.linkedin.com',
      'www.instagram.com',
      'x.com',
      // UI form placeholder text (dashboard.html `placeholder:` attribute
      // values) illustrating the expected format for a field the USER
      // fills in with their own webhook/feed URL — never fetched by
      // monomind itself, purely greyed-out hint text in an input box.
      'discord.com',
      'hooks.slack.com',
      'feeds.example.com',
      // Non-network XML/schema namespace identifiers.
      'www.w3.org', // SVG xmlns, present in every bundled avatar .svg
      'json-schema.org',
      'gexf.net',
      'graphml.graphdrawing.org',
      // Doc-string / code-comment artifacts that are not real hosts at all.
      'www.apple.com', // org.ts launchd plist DOCTYPE url, never fetched
      'x', // routes-org.mjs: `new URL(\`http://x${req.url}\`)` — a throwaway parse base
      'api', // monobrowse commands.ts --help example text "https://api.*" (regex-truncated, trailing dot stripped)
      'example.com', // monobrowse commands.ts --help example text
    ]);

    it('the reviewed host set is not stale: every reviewed host still appears in shipped source', () => {
      const found = findAllExternalHosts();
      for (const host of REVIEWED_HOSTS) {
        expect(
          found.has(host),
          `${host} is reviewed but no longer appears anywhere in shipped source — remove the stale entry`,
        ).toBe(true);
      }
    });

    it('every external host in shipped source is classified — not necessarily a request, but never silent', () => {
      const found = findAllExternalHosts();
      const unexpected = [...found.keys()].filter((h) => !REVIEWED_HOSTS.has(h));
      const detail = unexpected.map((h) => `${h} (in ${found.get(h)?.join(', ')})`);
      expect(
        detail,
        'unclassified external host(s) found in shipped source — each needs a doc/privacy.md row, verdict, "on purpose" bullet, or a reviewed-hosts entry with a reason (not silence, and not necessarily a new request row — e.g. an XML namespace URI is classified as "not a request", not given a false table row)',
      ).toEqual([]);
    });
  });

  describe('§4 — the true, Second-Brain-scoped claims survive unchanged', () => {
    it('README.md still says notes never leave the computer, verbatim', () => {
      const readme = readFileSync(join(REPO_ROOT, 'README.md'), 'utf-8');
      expect(readme).toContain(
        'Everything runs on your machine: a local embedding model (`Alibaba-NLP/gte-modernbert-base`, 768-dim, via transformers.js) and a local SQLite vector store. **Your notes never leave your computer.**',
      );
      expect(readme).toContain(
        'That download is the only outbound request the Second Brain ever makes — your documents and queries never leave your machine.',
      );
    });
  });

  describe('§5 — doc/privacy.md is a resolvable doc link', () => {
    it('node scripts/check-doc-refs.mjs passes', () => {
      expect(() =>
        execFileSync(process.execPath, [join(REPO_ROOT, 'scripts', 'check-doc-refs.mjs')], {
          cwd: REPO_ROOT,
          stdio: 'pipe',
        }),
      ).not.toThrow();
    });
  });
});
