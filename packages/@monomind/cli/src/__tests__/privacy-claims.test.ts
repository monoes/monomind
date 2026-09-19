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
