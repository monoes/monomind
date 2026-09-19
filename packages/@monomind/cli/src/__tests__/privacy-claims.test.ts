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
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
      ['package.json', 'package.json'],
      ['packages/@monomind/cli/package.json', 'packages/@monomind/cli/package.json'],
      ['doc/getting-started.md', 'doc/getting-started.md'],
      ['doc/llms.txt', 'doc/llms.txt'],
    ])('%s links to privacy.md', (_label, relPath) => {
      const text = readFileSync(join(REPO_ROOT, relPath), 'utf-8');
      expect(text).toMatch(/privacy\.md/);
    });

    it('the fallow.cloud and monograph.dev verdicts are both written down', () => {
      const table = readFileSync(join(REPO_ROOT, 'doc', 'privacy.md'), 'utf-8');
      expect(table).toMatch(/fallow\.cloud/i);
      expect(table).toMatch(/i-097/);
      expect(table).toMatch(/monograph\.dev/i);
    });
  });

  // §3b (reviewer MAJOR 3, i-078 revision round 1): the tests above can only
  // confirm rows that already exist — none of them can detect a REAL
  // outbound host missing from the table entirely, which is the only way
  // this item actually fails (three such gaps shipped in the first round).
  // This derives the expected host set from the source itself — every real
  // fetch()/httpsGet()/http(s).request() call site under packages/*/src —
  // and fails if a host shows up there with no matching row, verdict, or
  // reviewed exclusion below. Confirming listed rows cannot find an omitted
  // one; only re-deriving from the call sites can.
  describe('§3b — completeness: every automatic fetch/httpsGet call site is covered', () => {
    const PACKAGE_SRC_ROOTS = [
      'packages/monofence-ai/src',
      'packages/@monoes/monobrowse/src',
      'packages/@monoes/monodesign/src',
      'packages/@monomind/cli/src',
      'packages/@monomind/hooks/src',
      'packages/@monomind/mcp/src',
      'packages/@monomind/memory/src',
      'packages/@monomind/monograph/src',
      'packages/@monomind/routing/src',
    ];
    const CALL_SITE = /\b(fetch|httpsGet)\(|\bhttps?\.request\(/;

    /** Every non-test .ts/.mjs file under every package's src/ containing a
     * real fetch/httpsGet/http(s).request call-site TOKEN — walked fresh at
     * test time, not a hand-maintained list, which is what lets this go red
     * when someone adds a new site. (It also flags files where that token
     * only appears inside a comment, e.g. an illustrative code snippet —
     * those get an explicit "comment only" exclusion below rather than being
     * silently skipped, so the reviewed list stays honest about why.) */
    function findNetworkCallSiteFiles(): string[] {
      const files: string[] = [];
      const walk = (dir: string): void => {
        let entries: ReturnType<typeof readdirSync>;
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
      return files.sort();
    }

    // Reviewed, one reason each. A file lands here ONLY if its destination
    // is local-only (never leaves the machine), a host/credential the USER
    // configured (covered by a "what's not in this table, on purpose"
    // bullet), already covered by a dead-code verdict above, or contains the
    // call-site token only inside a comment. Everything NOT listed here must
    // have a literal host, and that host must be named in doc/privacy.md —
    // checked below. If a listed file's real destination ever changes,
    // "every excluded file still has a real call site" (next test) does NOT
    // catch that — only re-reading this list on review does.
    const REVIEWED_EXCLUSIONS: Record<string, string> = {
      // Local-only: hostname is 'localhost'/'127.0.0.1'/a loopback literal.
      'packages/@monomind/cli/src/mcp-server.ts':
        'local health check against its own MCP server process (http://host:port/health)',
      'packages/@monomind/cli/src/commands/events.ts': 'local dashboard control-port stream',
      'packages/@monomind/cli/src/commands/init-upgrade.ts':
        'local dashboard control-port progress event (default port 4242)',
      'packages/@monomind/cli/src/commands/org.ts':
        'local dashboard control-port, default http://localhost:4242',
      'packages/@monomind/cli/src/orgrt/forwarder.ts':
        'local dashboard control.json url, default http://localhost:4242',
      'packages/@monomind/cli/src/mcp-tools/browser-tools.ts':
        'local Chrome DevTools Protocol (127.0.0.1)',
      'packages/@monomind/cli/src/ui/server.mjs':
        "its own local self-callbacks (hostname: 'localhost') and 127.0.0.1 status probe",
      'packages/@monoes/monobrowse/src/browser/browser.ts':
        'local Chrome DevTools Protocol (127.0.0.1)',
      'packages/@monoes/monobrowse/src/browser/cdp.ts':
        'local Chrome DevTools Protocol (127.0.0.1)',
      'packages/@monoes/monobrowse/src/cli/commands.ts':
        'local Chrome DevTools Protocol (127.0.0.1)',
      'packages/@monomind/monograph/src/web/react-ui.ts':
        "relative fetch('/api/search') to its own serving origin, not an absolute host",

      // User-configured provider/endpoint/credential — "Configuring an org
      // role..." / "Distributed org coordination..." bullets.
      'packages/@monomind/cli/src/commands/providers.ts':
        'reachability check against a user-configured Ollama base URL',
      'packages/@monomind/cli/src/orgrt/endpoint-roles.ts':
        "a role's endpoint.url, configured by the user in their own org/role file",
      'packages/@monomind/cli/src/commands/org-observe.ts':
        'a remote org host configured via org_observe --remote',
      'packages/@monomind/cli/src/orgrt/cross-org.ts': "a remote org's url, configured by the user",
      'packages/@monomind/cli/src/ui/routes-org.mjs':
        'a configured remote org host / cross-broker url',
      'packages/@monomind/mcp/src/oauth.ts': "a user-configured OAuth provider's tokenEndpoint",

      // User-explicit target — "A handful of commands send data to a target
      // you supply..." bullet.
      'packages/@monomind/cli/src/commands/security-misc.ts':
        'security redteam --target <url>, a target the user supplies',
      'packages/@monomind/monograph/src/security/safe-fetch.ts':
        "SSRF-guarded fetch of a URL the caller (e.g. Monograph's URL ingest) passed it",
      'packages/@monomind/monograph/src/wiki/gist-publisher.ts':
        "publishing to a GitHub gist with the user's own token",

      // Already covered by a dead-code verdict above — no live caller.
      'packages/@monomind/monograph/src/license/manager.ts': 'api.fallow.cloud verdict (dead code)',
      'packages/@monomind/monograph/src/coverage/cloud-client.ts':
        'api.fallow.cloud verdict (dead code)',
      'packages/@monomind/monograph/src/coverage/upload-inventory.ts':
        'api.fallow.cloud verdict (dead code)',
      'packages/@monomind/monograph/src/coverage/upload-source-maps.ts':
        'api.fallow.cloud verdict (dead code)',
      'packages/@monomind/mcp/src/sampling.ts': 'api.anthropic.com verdict (dead code)',
      'packages/@monomind/monograph/src/wiki/providers.ts':
        'api.openai.com verdict (unreachable — llmConfig never set by any non-test caller)',

      // Comment only — the token appears inside a code comment, not a call.
      'packages/@monomind/cli/src/orgrt/role-sandbox.ts':
        'illustrative example inside a comment ("fetch(\'https://registry.npmjs.org/…\')"), not a real call',
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

    it('every non-excluded call-site file has a literal host, and every such host is named in doc/privacy.md', () => {
      const privacy = readFileSync(join(REPO_ROOT, 'doc', 'privacy.md'), 'utf-8').toLowerCase();
      const HOST = /https?:\/\/([a-zA-Z0-9.-]+)/g;
      const unreviewed = findNetworkCallSiteFiles().filter((f) => !(f in REVIEWED_EXCLUSIONS));

      for (const file of unreviewed) {
        const text = readFileSync(join(REPO_ROOT, file), 'utf-8');
        const hosts = [...new Set([...text.matchAll(HOST)].map((m) => m[1].toLowerCase()))].filter(
          (h) => h !== 'localhost' && !/^(\d{1,3}\.){3}\d{1,3}$/.test(h),
        );
        expect(
          hosts.length,
          `${file} has a fetch/httpsGet/request call site with no literal https?:// host found in the file — it needs either a doc/privacy.md row, a dead-code verdict, or a reviewed exclusion (with a reason) in this test, not silence`,
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
