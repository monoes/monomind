/**
 * GH #344: init wrapped the shipped Mastermind skills (SKILL.md and
 * mastermind/references/*) in `skills:<platform>:<name>` ownership markers,
 * so every init — `--force` or not — rewrote files whose content it had not
 * otherwise changed. Ownership now comes from the init manifest's file hashes
 * (file-guard.ts), like every other shipped file: no markers are written, a
 * file an older version marked is migrated back to the shipped bytes when the
 * user did not edit it, and kept (new version beside it) when they did.
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initCommand } from '../src/commands/init.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

vi.mock('child_process', () => {
  const fail = () => {
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(fail),
    execFileSync: vi.fn(fail),
    exec: vi.fn(fail),
    execFile: vi.fn(fail),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      return proc;
    }),
  };
});

const SOURCE = path.join(__dirname, '..', '.claude', 'skills');
const ROOTS = ['.claude/skills', '.agents/skills'];
const OWNERSHIP = /monomind:(?:start|end) skills:/;
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The 2.16.5 form: HTML-comment markers after the frontmatter's blank line. */
function htmlMarked(shipped: string, marker: string): string {
  const header = /^---\n[\s\S]*?\n---\n/.exec(shipped)?.[0] ?? '';
  const body = shipped.slice(header.length).replace(/^\n/, '').replace(/\n+$/, '');
  return `${header}${header ? '\n' : ''}<!-- monomind:start ${marker} -->\n${body}\n<!-- monomind:end ${marker} -->\n`;
}

/** The pre-2.16.5 form: `#` lines, the start marker written over the blank line. */
function hashMarked(shipped: string, marker: string): string {
  const header = /^---\n[\s\S]*?\n---\n/.exec(shipped)?.[0] ?? '';
  const body = shipped.slice(header.length).replace(/^\n/, '').replace(/\n+$/, '');
  return `${header}# monomind:start ${marker}\n${body}\n# monomind:end ${marker}\n`;
}

const CASES = [
  {
    rel: '.claude/skills/mastermind-debug/SKILL.md',
    src: 'mastermind-debug/SKILL.md',
    mark: htmlMarked,
    marker: 'skills:claude:mastermind-debug',
  },
  {
    rel: '.claude/skills/mastermind-plan/SKILL.md',
    src: 'mastermind-plan/SKILL.md',
    mark: hashMarked,
    marker: 'skills:claude:mastermind-plan',
  },
  {
    rel: '.agents/skills/mastermind-review/SKILL.md',
    src: 'mastermind-review/SKILL.md',
    mark: htmlMarked,
    marker: 'skills:agents:mastermind-review',
  },
  {
    rel: '.agents/skills/mastermind/references/codex-tools.md',
    src: 'mastermind/references/codex-tools.md',
    mark: hashMarked,
    marker: 'skills:agents:mastermind:references/codex-tools.md',
  },
];

describe('init and skill ownership markers (GH #344)', () => {
  let tmpDir: string;
  let fakeHome: string;
  let realHome: string | undefined;
  const file = (rel: string) => path.join(tmpDir, rel);
  const read = (rel: string) => fs.readFileSync(file(rel), 'utf8');
  const shipped = (src: string) => fs.readFileSync(path.join(SOURCE, src), 'utf8');
  const init = (flags: Record<string, unknown> = {}) =>
    initCommand.action!({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, 'no-memory': true, ...flags },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);
  const skillFiles = () =>
    ROOTS.flatMap((root) =>
      fs.existsSync(file(root))
        ? fs
            .readdirSync(file(root), { recursive: true, withFileTypes: true })
            .filter((entry) => entry.isFile())
            .map((entry) => path.relative(tmpDir, path.join(entry.parentPath, entry.name)))
        : [],
    );
  const manifestPath = () => file('.monomind/init-manifest.json');
  const editManifest = (edit: (files: Record<string, string>) => void) => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
    manifest.files ??= {};
    edit(manifest.files);
    fs.writeFileSync(manifestPath(), JSON.stringify(manifest));
  };
  /** Seed each case in its marked form, as an older version left it. */
  const seed = (content: (c: (typeof CASES)[number]) => string, recorded: boolean) => {
    const seeded: Record<string, string> = {};
    for (const c of CASES) {
      seeded[c.rel] = content(c);
      fs.writeFileSync(file(c.rel), seeded[c.rel]!);
    }
    editManifest((files) => {
      for (const c of CASES) {
        if (recorded) files[c.rel] = sha256(c.mark(shipped(c.src), c.marker));
        else delete files[c.rel];
      }
    });
    return seeded;
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-skill-markers-'));
    fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-skill-markers-home-'));
    realHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    try {
      const bridge = await import('../src/memory/memory-bridge.js');
      await bridge.shutdownBridge();
    } catch {}
    process.env.HOME = realHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });

  it('a fresh init writes the shipped skills without ownership markers', async () => {
    expect((await init({ yes: true })).success).toBe(true);
    const files = skillFiles();
    expect(files.length).toBeGreaterThan(30);
    expect(files.filter((rel) => OWNERSHIP.test(read(rel)))).toEqual([]);
    for (const c of CASES) expect(read(c.rel), c.rel).toBe(shipped(c.src));
  }, 180000);

  it.each([
    ['recorded', true],
    ['unrecorded', false],
  ])('migrates unedited %s files carrying old `#` and HTML markers back to the shipped bytes', async (_label, recorded) => {
    await init({ yes: true });
    seed((c) => c.mark(shipped(c.src), c.marker), recorded);

    const result = await init({ yes: true });
    expect(result.success).toBe(true);
    for (const c of CASES) {
      expect(read(c.rel), c.rel).toBe(shipped(c.src));
      expect(fs.existsSync(file(`${c.rel}.monomind-new`)), c.rel).toBe(false);
    }
  }, 180000);

  it.each([
    ['recorded, --force', true, { force: true, yes: true }],
    ['recorded, -y', true, { yes: true }],
    ['unrecorded, -y', false, { yes: true }],
  ])('keeps a marked file edited inside or outside its markers (%s)', async (_label, recorded, flags) => {
    await init({ yes: true });
    const seeded = seed((c) => {
      const marked = c.mark(shipped(c.src), c.marker);
      return CASES.indexOf(c) % 2 === 0
        ? marked.replace(/\n(<!-- |# )monomind:end /, '\nMY EDIT INSIDE\n$1monomind:end ')
        : `${marked}\nMY NOTES OUTSIDE\n`;
    }, recorded);

    const result = await init(flags);
    expect(result.success).toBe(true);
    const kept = (result.data as { kept?: string[] }).kept ?? [];
    for (const c of CASES) {
      expect(read(c.rel), c.rel).toBe(seeded[c.rel]);
      expect(read(`${c.rel}.monomind-new`), c.rel).toBe(shipped(c.src));
      expect(kept, c.rel).toContain(c.rel);
    }
  }, 180000);

  it('a second init writes no skill file at all', async () => {
    await init({ yes: true });
    const before = new Map(skillFiles().map((rel) => [rel, fs.statSync(file(rel)).mtimeMs]));
    // Past any coarse mtime granularity, so a rewrite cannot hide.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect((await init({ yes: true })).success).toBe(true);
    const rewritten = skillFiles().filter((rel) => fs.statSync(file(rel)).mtimeMs !== before.get(rel));
    expect(rewritten).toEqual([]);
  }, 180000);
});
