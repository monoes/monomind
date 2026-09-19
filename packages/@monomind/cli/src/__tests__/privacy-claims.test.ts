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

  // §3b (reviewer MAJOR 3, i-078 revision round 1; widened in revision 2):
  // the tests above can only confirm rows that already exist — none of them
  // can detect a REAL outbound host missing from the table entirely, which
  // is the only way this item actually fails (three such gaps shipped in
  // round 1). This derives the expected host set from the source itself —
  // every real fetch()/httpsGet()/http(s).request() call site (including
  // the destructured-alias shape, e.g. `const { fetch: fn = globalThis.fetch
  // } = opts`) under every package's SHIPPED surface — and fails if a host
  // shows up there with no matching row, verdict, or reviewed exclusion
  // below. Confirming listed rows cannot find an omitted one; only
  // re-deriving from the call sites can.
  describe('§3b — completeness: every automatic fetch/httpsGet call site is covered', () => {
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

    // Matches a direct call (fetch(/httpsGet(/http(s).request() AND the
    // destructured-fetch-alias-with-default shape found in
    // ingest/url-ingest.ts (`{ fetch: fetchFn = globalThis.fetch }`, then
    // `fetchFn(...)`) — a real call site the direct-call pattern alone
    // cannot see (i-078 revision 2, reviewer MAJOR 2). Verified against this
    // repo (revision 2): no axios/got/undici/node-fetch/superagent/ky is
    // imported anywhere under any package's shipped surface, and no
    // curl/wget is exec'd to fetch — so these two shapes cover every HTTP
    // client actually in use. This is NOT a general HTTP-client detector and
    // should not be extended to hunt for libraries that aren't there.
    const CALL_SITE = /\b(fetch|httpsGet)\(|\bhttps?\.request\(|\bfetch\s*:\s*\w+\s*=/;

    /** Every source root a package actually SHIPS, derived from its own
     * package.json `files` (i-078 revision 2, verifier MAJOR: a
     * hand-written `<pkg>/src`-only list missed two real, shipped call
     * sites — `@monoes/monodesign`'s `skill/scripts/context.mjs` and
     * `@monomind/cli`'s `scripts/understand-analyze.mjs` — because neither
     * lives under `src/`). `src` is always included even when a package's
     * `files` doesn't list it literally (most list only `dist`, the
     * compiled OUTPUT `src` produces) — scanning generated `dist/*.js`
     * instead of the hand-authored source it came from would only catch a
     * new call site one build cycle later than scanning the source itself,
     * and would require a build before every test run. `dist`, single
     * files (README.md, LICENSE, tokens.css, …) and negation globs
     * (`!dist/**`) are excluded — they're either compiled output or not
     * directories of source at all. */
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
    const PACKAGE_SRC_ROOTS = PACKAGE_DIRS.flatMap(shippedSourceRoots);

    /** Every non-test .ts/.mjs file under every package's shipped source
     * root(s) containing a real call-site TOKEN — walked fresh at test
     * time, not a hand-maintained list, which is what lets this go red when
     * someone adds a new site. (It also flags files where that token only
     * appears inside a comment, e.g. an illustrative code snippet — those
     * get an explicit "comment only" exclusion below rather than being
     * silently skipped, so the reviewed list stays honest about why.) */
    function findNetworkCallSiteFiles(): string[] {
      const files: string[] = [];
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
            (entry.name.endsWith('.ts') || entry.name.endsWith('.mjs')) &&
            !entry.name.endsWith('.test.ts')
          ) {
            const text = readFileSync(join(REPO_ROOT, rel), 'utf-8');
            if (CALL_SITE.test(text)) files.push(rel);
          }
        }
      };
      for (const root of PACKAGE_SRC_ROOTS) walk(root);
      return [...new Set(files)].sort();
    }

    const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g;
    const LOOPBACK_LIKE = (h: string): boolean =>
      h === 'localhost' || /^(\d{1,3}\.){3}\d{1,3}$/.test(h);

    /** Every literal `https?://host` substring in a file, lowercased,
     * deduped — including loopback ones (the exclusion review needs those
     * too, to prove a file really IS only loopback, not just unexamined). */
    function literalHosts(relPath: string): string[] {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      return [...new Set([...text.matchAll(HOST)].map((m) => m[1].toLowerCase()))].sort();
    }

    // Reviewed, one reason + its CURRENT literal hosts each. A file lands
    // here ONLY if its destination is local-only (never leaves the
    // machine), a host/credential the USER configured (covered by a "what's
    // not in this table, on purpose" bullet), already covered by a
    // dead-code verdict above, or contains the call-site token only inside
    // a comment.
    //
    // `hosts` is keyed by file rather than left implicit (i-078 revision 2,
    // reviewer MAJOR 1): a FILE-only exclusion list is a standing exemption
    // — once a file is listed, every future call site inside it is
    // invisible forever, proven by mutation (adding a brand-new external
    // host to an already-excluded file stayed green). Listing each file's
    // reviewed hosts and asserting the file's CURRENT literal hosts are a
    // SUBSET of that list (below) means a genuinely NEW host in an already
    // -excluded file still goes red, while the file itself doesn't need
    // re-excluding every time.
    //
    // Everything NOT listed here must have a literal host, and that host
    // must be named in doc/privacy.md — checked separately below.
    const REVIEWED_EXCLUSIONS: Record<string, { reason: string; hosts: string[] }> = {
      // Local-only: every literal host is 'localhost'/'127.0.0.1'/a loopback IP.
      'packages/@monomind/cli/src/mcp-server.ts': {
        reason: 'local health check against its own MCP server process (http://host:port/health)',
        hosts: [],
      },
      'packages/@monomind/cli/src/commands/events.ts': {
        reason: 'local dashboard control-port stream',
        hosts: ['localhost'],
      },
      'packages/@monomind/cli/src/commands/init-upgrade.ts': {
        reason: 'local dashboard control-port progress event (default port 4242)',
        hosts: ['localhost'],
      },
      'packages/@monomind/cli/src/commands/org.ts': {
        reason:
          'local dashboard control-port, default http://localhost:4242; also contains ' +
          'http://www.apple.com — the DOCTYPE url in a generated launchd plist string, never ' +
          'fetched (same category as the monograph.dev $schema verdict)',
        hosts: ['127.0.0.1', 'localhost', 'www.apple.com'],
      },
      'packages/@monomind/cli/src/orgrt/forwarder.ts': {
        reason: 'local dashboard control.json url, default http://localhost:4242',
        hosts: ['localhost'],
      },
      'packages/@monomind/cli/src/mcp-tools/browser-tools.ts': {
        reason: 'local Chrome DevTools Protocol (127.0.0.1)',
        hosts: ['127.0.0.1'],
      },
      'packages/@monomind/cli/src/ui/server.mjs': {
        reason: "its own local self-callbacks (hostname: 'localhost') and 127.0.0.1 status probe",
        hosts: ['127.0.0.1', 'localhost'],
      },
      'packages/@monoes/monobrowse/src/browser/browser.ts': {
        reason: 'local Chrome DevTools Protocol (127.0.0.1)',
        hosts: ['127.0.0.1'],
      },
      'packages/@monoes/monobrowse/src/browser/cdp.ts': {
        reason: 'local Chrome DevTools Protocol (127.0.0.1)',
        hosts: ['127.0.0.1'],
      },
      'packages/@monoes/monobrowse/src/cli/commands.ts': {
        reason:
          'local Chrome DevTools Protocol (127.0.0.1); also contains https://example.com / ' +
          'https://api.* inside `examples:` help text (--help output), never fetched',
        hosts: ['127.0.0.1', 'api.', 'example.com'],
      },
      // monodesign's live-preview server: same local-CDP/local-HTTP-server
      // shape as monobrowse above — a design-preview loop talking to its
      // own localhost port, never leaving the machine.
      'packages/@monoes/monodesign/cli/engine/engines/browser/drivers.mjs': {
        reason: 'local Chrome DevTools Protocol (127.0.0.1)',
        hosts: ['127.0.0.1'],
      },
      'packages/@monoes/monodesign/cli/engine/node/file-system.mjs': {
        reason: 'local dev-server reachability probe (http://localhost:<port>/)',
        hosts: ['localhost'],
      },
      'packages/@monoes/monodesign/skill/scripts/live-complete.mjs': {
        reason: "local live-preview server's own port (http://localhost:<port>)",
        hosts: ['localhost'],
      },
      'packages/@monoes/monodesign/skill/scripts/live-poll.mjs': {
        reason: "local live-preview server's own port (http://localhost:<port>)",
        hosts: ['localhost'],
      },
      'packages/@monoes/monodesign/skill/scripts/live-server.mjs': {
        reason: "local live-preview server's own port (http://localhost:<port>)",
        hosts: ['localhost'],
      },
      'packages/@monoes/monodesign/skill/scripts/live-status.mjs': {
        reason: "local live-preview server's own port (http://localhost:<port>)",
        hosts: ['localhost'],
      },

      // User-configured provider/endpoint/credential — "Configuring an org
      // role..." / "Distributed org coordination..." bullets.
      'packages/@monomind/cli/src/commands/providers.ts': {
        reason: 'reachability check against a user-configured Ollama base URL',
        hosts: ['localhost'],
      },
      'packages/@monomind/cli/src/orgrt/endpoint-roles.ts': {
        reason: "a role's endpoint.url, configured by the user in their own org/role file",
        hosts: [],
      },
      'packages/@monomind/cli/src/commands/org-observe.ts': {
        reason: 'a remote org host configured via org_observe --remote',
        hosts: [],
      },
      'packages/@monomind/cli/src/orgrt/cross-org.ts': {
        reason: "a remote org's url, configured by the user",
        hosts: [],
      },
      'packages/@monomind/cli/src/ui/routes-org.mjs': {
        reason:
          'a configured remote org host / cross-broker url; also `new URL(`http://x${req.url}`)`' +
          ' several times — "x" is a throwaway base used only to parse a relative req.url\'s own ' +
          'path/query via the URL constructor, never dereferenced or fetched',
        hosts: ['localhost', 'x'],
      },
      'packages/@monomind/mcp/src/oauth.ts': {
        reason:
          "a user-configured OAuth provider's tokenEndpoint; the literal hosts are the built-in " +
          'GitHub/Google provider PRESETS (authorizationEndpoint/tokenEndpoint defaults a user ' +
          'selects), not requests made without the user choosing that provider',
        hosts: ['accounts.google.com', 'github.com', 'oauth2.googleapis.com'],
      },

      // User-explicit target — "A handful of commands send data to a target
      // you supply..." bullet.
      'packages/@monomind/cli/src/commands/security-misc.ts': {
        reason:
          'security redteam --target <url>, a target the user supplies; also cites ' +
          'https://github.com/Azure/PyRIT in a source-attribution comment, never fetched',
        hosts: ['github.com', 'localhost'],
      },
      'packages/@monomind/monograph/src/ingest/url-ingest.ts': {
        reason:
          'ingestUrl(url, options) fetches a URL the CALLER supplies, via its own fetchFn ' +
          '(defaulting to globalThis.fetch) — guarded by validateUrl (SSRF/private-IP check, ' +
          "re-checked after redirects), not by safeFetch (see safe-fetch.ts's entry below, " +
          'they are different exports of the same file)',
        hosts: [],
      },
      'packages/@monomind/monograph/src/wiki/gist-publisher.ts': {
        reason: "publishing to a GitHub gist with the user's own token",
        hosts: ['api.github.com'],
      },

      // Already covered by a dead-code verdict above — no live caller.
      'packages/@monomind/monograph/src/license/manager.ts': {
        reason: 'api.fallow.cloud verdict (dead code)',
        hosts: ['api.fallow.cloud'],
      },
      'packages/@monomind/monograph/src/coverage/cloud-client.ts': {
        reason: 'api.fallow.cloud verdict (dead code)',
        hosts: ['api.fallow.cloud'],
      },
      'packages/@monomind/monograph/src/coverage/upload-inventory.ts': {
        reason: 'api.fallow.cloud verdict (dead code)',
        hosts: ['api.fallow.cloud'],
      },
      'packages/@monomind/monograph/src/coverage/upload-source-maps.ts': {
        reason: 'api.fallow.cloud verdict (dead code)',
        hosts: ['api.fallow.cloud'],
      },
      'packages/@monomind/mcp/src/sampling.ts': {
        reason: 'api.anthropic.com verdict (dead code — zero callers, see verdicts above)',
        hosts: ['api.anthropic.com'],
      },
      'packages/@monomind/monograph/src/wiki/providers.ts': {
        reason: 'api.openai.com verdict (unreachable — llmConfig never set by any non-test caller)',
        hosts: ['api.openai.com', 'localhost'],
      },
      'packages/@monomind/monograph/src/security/safe-fetch.ts': {
        // i-078 revision 2 (verifier MINOR 3): `safeFetch` — the function
        // IN this file that actually calls fetch(rawUrl) — has NO live
        // caller anywhere in this repo (only its own tests, and a blanket
        // `export *` from monograph's index.ts). url-ingest.ts, the file
        // this exclusion used to (wrongly) credit, imports and calls only
        // `validateUrl` from this same file — a pure guard with no fetch
        // call of its own. So safeFetch's fetch(rawUrl,...) call site is
        // dead code (its rawUrl param is fully dynamic, so there is no
        // fixed host to verdict the way fallow.cloud/anthropic/openai have
        // one — it's excluded here rather than in the verdicts section
        // above because there's no destination host to name).
        reason:
          "safeFetch has no live caller anywhere in this repo — dead code, not url-ingest's guard",
        hosts: [],
      },
      'packages/@monoes/monodesign/skill/scripts/context.mjs': {
        reason: 'github.com/monoes/monomind api.version verdict (dead code, see verdicts above)',
        hosts: ['github.com'],
      },

      // Comment only — the token appears inside a code comment, not a call.
      'packages/@monomind/cli/src/orgrt/role-sandbox.ts': {
        reason:
          'illustrative example inside a comment ("fetch(\'https://registry.npmjs.org/…\')"), ' +
          'not a real call',
        hosts: ['registry.npmjs.org'],
      },
    };

    it('the exclusion list is not stale: every excluded file still has a real call-site token', () => {
      const found = new Set(findNetworkCallSiteFiles());
      for (const file of Object.keys(REVIEWED_EXCLUSIONS)) {
        expect(
          found.has(file),
          `${file} is excluded but no longer contains a fetch/httpsGet/request token — remove the stale exclusion`,
        ).toBe(true);
      }
    });

    // i-078 revision 2 (reviewer MAJOR 1): a file-only exclusion is a
    // standing exemption for every FUTURE call site in that file too —
    // proven by mutation (a brand-new external fetch added to an
    // already-excluded file stayed green). Pinning each file's reviewed
    // hosts and requiring its CURRENT literal hosts to be a SUBSET closes
    // that: a genuinely new host is not in the reviewed set, so it's not a
    // subset, so this goes red.
    it("every excluded file's current literal hosts are still a subset of its reviewed hosts", () => {
      for (const [file, { hosts: reviewed }] of Object.entries(REVIEWED_EXCLUSIONS)) {
        if (!existsSync(join(REPO_ROOT, file))) continue; // caught by the staleness test above
        const current = literalHosts(file);
        const unreviewed = current.filter((h) => !reviewed.includes(h));
        expect(
          unreviewed,
          `${file} now has host(s) not in its reviewed set: ${unreviewed.join(', ')} — a new outbound destination in an already-excluded file, which needs review (not silent coverage by the file-level exclusion)`,
        ).toEqual([]);
      }
    });

    it('every non-excluded call-site file has a literal host, and every such host is named in doc/privacy.md', () => {
      const privacy = readFileSync(join(REPO_ROOT, 'doc', 'privacy.md'), 'utf-8').toLowerCase();
      const unreviewed = findNetworkCallSiteFiles().filter((f) => !(f in REVIEWED_EXCLUSIONS));

      for (const file of unreviewed) {
        const hosts = literalHosts(file).filter((h) => !LOOPBACK_LIKE(h));
        expect(
          hosts.length,
          `${file} has a fetch/httpsGet/request call site with no literal https?:// host found in the file — it needs either a doc/privacy.md row, a dead-code verdict, or a reviewed exclusion (with a reason and its hosts) in this test, not silence`,
        ).toBeGreaterThan(0);
        for (const host of hosts) {
          expect(
            privacy.includes(host),
            `${file} calls out to "${host}", which is not named anywhere in doc/privacy.md`,
          ).toBe(true);
        }
      }
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
