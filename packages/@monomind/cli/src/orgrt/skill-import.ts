/**
 * Bring skills from other projects into the org skill library.
 *
 * Only MIT and Apache-2.0 skills are imported. A skill's own license (its
 * frontmatter `license:` or a LICENSE file in its directory) wins over its
 * repository's. Every imported skill records where it came from — source
 * repo, path and commit — in its frontmatter, and the governing license text
 * is kept beside it, as both licenses require.
 *
 * Only `.md` files are copied: roles read skills, they don't run their
 * bundled scripts.
 */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { parseFrontmatter, SKILL_NAME_RE } from './skill-library.js';

export type ImportLicense = 'MIT' | 'Apache-2.0';

const LICENSE_FILE_RE = /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

/** MIT / Apache-2.0 from a frontmatter value or a license file's text. */
export function classifyLicense(text: string | undefined): ImportLicense | undefined {
  if (!text) return undefined;
  const t = text.trim();
  if (/^["']?mit( license)?["']?$/i.test(t)) return 'MIT';
  if (/^["']?apache[- ]?(license[- ]?)?(v(ersion)?[- ]?)?2(\.0)?( license)?["']?$/i.test(t))
    return 'Apache-2.0';
  if (
    /Permission is hereby granted, free of charge/.test(t) &&
    /MIT License|THE SOFTWARE IS PROVIDED "AS IS"/.test(t)
  )
    return 'MIT';
  if (/Apache License/.test(t) && /Version 2\.0/.test(t)) return 'Apache-2.0';
  return undefined;
}

function licenseFileIn(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).find((n) => LICENSE_FILE_RE.test(n));
  return f ? join(dir, f) : undefined;
}

export interface LicenseVerdict {
  license?: ImportLicense;
  /** The file holding the license text to keep, when one exists. */
  file?: string;
  /** What was found, for the refusal message. */
  found: string;
}

/** Which license governs a skill directory inside a repository. */
export function skillLicense(
  skillDir: string,
  repoRoot: string,
  declared?: string,
): LicenseVerdict {
  const own = licenseFileIn(skillDir);
  const repo = licenseFileIn(repoRoot);
  const textOf = (f: string | undefined) =>
    f ? classifyLicense(readFileSync(f, 'utf-8')) : undefined;
  // Keep a license file only when it holds the license that governs.
  const keep = (l: ImportLicense) => [own, repo].find((f) => f && textOf(f) === l);
  const named = classifyLicense(declared);
  if (named) return { license: named, file: keep(named), found: declared as string };
  // "Complete terms in LICENSE.txt" points at the skill's own file.
  if (declared && !/LICEN[CS]E\b.*\.|LICEN[CS]E\.(txt|md)|LICEN[CS]E file/i.test(declared)) {
    return { found: declared };
  }
  if (own) {
    const l = textOf(own);
    return {
      license: l,
      file: l ? own : undefined,
      found: l ?? `${basename(own)} (not MIT/Apache-2.0)`,
    };
  }
  if (!repo) return { found: 'no license' };
  const l = textOf(repo);
  return {
    license: l,
    file: l ? repo : undefined,
    found: l ?? 'repository license (not MIT/Apache-2.0)',
  };
}

/** Every directory holding a SKILL.md under `root`. */
export function findSkillDirs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) out.push(dir);
    for (const e of entries) if (e.isDirectory() && !SKIP_DIRS.has(e.name)) walk(join(dir, e.name));
  };
  walk(root);
  return out;
}

function mdFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) out.push(...mdFiles(dir, rel));
    else if (e.isFile() && e.name.endsWith('.md') && rel !== 'SKILL.md') out.push(rel);
  }
  return out.sort();
}

export const toSkillName = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

export interface ImportSpec {
  srcDir: string;
  repoRoot: string;
  /** e.g. https://github.com/owner/repo */
  source: string;
  commit?: string;
  name?: string;
  description?: string;
  tags?: string[];
  tools?: string[];
  /** Relative .md files to take (SKILL.md implied); default all. */
  files?: string[];
  /** The operator reviewed this skill and accepts the `tools` it asks for.
   *  Without it the skill is written `trust: untrusted` with no tools. */
  trusted?: boolean;
}

export type ImportResult =
  | { ok: true; name: string; license: ImportLicense; dir: string }
  | { ok: false; name: string; reason: string };

/** Import one skill directory into `destRoot/<name>/`. Refuses anything not
 *  MIT/Apache-2.0 and never overwrites an existing skill unless `overwrite`. */
export function importSkill(spec: ImportSpec, destRoot: string, overwrite = false): ImportResult {
  const { data, body } = parseFrontmatter(readFileSync(join(spec.srcDir, 'SKILL.md'), 'utf-8'));
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join(' ') : v);
  const name = toSkillName(spec.name ?? str(data.name) ?? basename(spec.srcDir));
  if (!SKILL_NAME_RE.test(name)) return { ok: false, name, reason: 'no usable name' };
  const verdict = skillLicense(spec.srcDir, spec.repoRoot, str(data.license));
  if (!verdict.license) return { ok: false, name, reason: `license: ${verdict.found}` };
  const description = (spec.description ?? str(data.description) ?? '').replace(/\s+/g, ' ').trim();
  if (!description) return { ok: false, name, reason: 'no description' };
  const dest = join(destRoot, name);
  if (existsSync(dest) && !overwrite) return { ok: false, name, reason: 'already in the library' };

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const q = JSON.stringify;
  const fm = [
    '---',
    `name: ${name}`,
    `description: ${q(description)}`,
    `tags: ${q(spec.tags ?? [])}`,
    // Tool-granting keys of the source (allowed-tools, tools, ...) are never
    // copied; tools are written only for a skill the operator confirmed.
    `tools: ${q(spec.trusted ? (spec.tools ?? []) : [])}`,
    `trust: ${spec.trusted ? 'trusted' : 'untrusted'}`,
    `license: ${verdict.license}`,
    `source: ${spec.source}`,
    `source_path: ${q(relative(spec.repoRoot, spec.srcDir) || '.')}`,
    ...(spec.commit ? [`source_commit: ${spec.commit}`] : []),
    '---',
    '',
  ].join('\n');
  writeFileSync(join(dest, 'SKILL.md'), `${fm}${body.trim()}\n`);
  for (const rel of spec.files ?? mdFiles(spec.srcDir)) {
    if (rel === 'SKILL.md' || !rel.endsWith('.md') || rel.split('/').includes('..')) continue;
    const from = join(spec.srcDir, rel);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(dest, rel)), { recursive: true });
    copyFileSync(from, join(dest, rel));
  }
  if (verdict.file) copyFileSync(verdict.file, join(dest, 'LICENSE.txt'));
  return { ok: true, name, license: verdict.license, dir: dest };
}

const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

/** `owner/repo`, a git URL, or a local path → a checkout to read from.
 *  A remote source is checked out at `opts.commit`; with `requirePin` a remote
 *  source without one is refused, so what is imported cannot move under you. */
export function checkout(
  src: string,
  opts: { commit?: string; requirePin?: boolean } = {},
): {
  root: string;
  source: string;
  commit?: string;
  cleanup: () => void;
} {
  if (existsSync(src)) {
    let commit: string | undefined;
    try {
      commit = execFileSync('git', ['-C', src, 'rev-parse', 'HEAD'], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      // not a git checkout — fine, no commit to record
    }
    return { root: src, source: src, commit, cleanup: () => {} };
  }
  const url = /^[\w.-]+\/[\w.-]+$/.test(src) ? `https://github.com/${src}` : src;
  if (!/^(https:\/\/|git@)/.test(url)) throw new Error(`not a path, owner/repo or git URL: ${src}`);
  if (opts.commit !== undefined && !COMMIT_RE.test(opts.commit))
    throw new Error(`--commit must be a 7-40 character hex commit id, got "${opts.commit}"`);
  if (opts.requirePin && !opts.commit)
    throw new Error(
      'importing from a remote repository requires a pinned commit: pass --commit <sha> (git rev-parse HEAD in the source)',
    );
  const tmp = mkdtempSync(join(tmpdir(), 'org-skill-import-'));
  const cleanup = () => rmSync(tmp, { recursive: true, force: true });
  try {
    if (opts.commit) {
      execFileSync('git', ['init', '--quiet', tmp], { stdio: 'ignore' });
      execFileSync('git', ['-C', tmp, 'remote', 'add', 'origin', url], { stdio: 'ignore' });
      execFileSync('git', ['-C', tmp, 'fetch', '--quiet', '--depth', '1', 'origin', opts.commit], {
        stdio: 'ignore',
      });
      execFileSync('git', ['-C', tmp, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], {
        stdio: 'ignore',
      });
    } else {
      execFileSync('git', ['clone', '--quiet', '--depth', '1', url, tmp], { stdio: 'ignore' });
    }
    const commit = execFileSync('git', ['-C', tmp, 'rev-parse', 'HEAD'], {
      encoding: 'utf-8',
    }).trim();
    if (opts.commit && !commit.startsWith(opts.commit.toLowerCase()))
      throw new Error(`fetched ${commit}, not the pinned ${opts.commit}`);
    return { root: tmp, source: url.replace(/\.git$/, ''), commit, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}

export interface ImportOptions {
  only?: string[];
  overwrite?: boolean;
  tags?: string[];
  /** Pinned commit of a remote source. Required for owner/repo and git URLs. */
  commit?: string;
  /** Mark the imported skills trusted and keep their requested tools. */
  trusted?: boolean;
}

/** Skill directories to import, one per name (first, shallowest claim wins). */
function candidates(root: string, only?: string[]): Array<{ dir: string; name: string }> {
  const dirs = findSkillDirs(root).sort(
    (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
  );
  const seen = new Set<string>();
  const out: Array<{ dir: string; name: string }> = [];
  for (const dir of dirs) {
    const { data } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf-8'));
    const name = toSkillName(typeof data.name === 'string' ? data.name : basename(dir));
    if (seen.has(name) || (only && !only.includes(name))) continue;
    seen.add(name);
    out.push({ dir, name });
  }
  return out;
}

/** What an import would bring in, for the operator to confirm: per skill the
 *  files taken and the tool-granting frontmatter keys that will be dropped. */
export function describeImport(
  source: string,
  commit: string | undefined,
  items: Array<{ dir: string; name: string }>,
  destRoot: string,
): string[] {
  const lines = [
    `Import from ${source}${commit ? ` @ ${commit}` : ' (no commit)'} into ${destRoot}:`,
  ];
  for (const { dir, name } of items) {
    const { data, body } = parseFrontmatter(readFileSync(join(dir, 'SKILL.md'), 'utf-8'));
    const granting = ['allowed-tools', 'allowed_tools', 'tools'].filter(
      (k) => data[k] !== undefined,
    );
    const files = ['SKILL.md', ...mdFiles(dir)];
    lines.push(
      `  ${name}: ${files.length} file(s), ${body.length} chars of instructions` +
        (existsSync(join(destRoot, name)) ? ' [replaces an existing skill]' : '') +
        (granting.length ? ` [drops tool keys: ${granting.join(', ')}]` : ''),
    );
    const first = body.trim().split('\n').find(Boolean);
    if (first) lines.push(`      starts: ${first.slice(0, 100)}`);
  }
  return lines;
}

function importItems(
  co: { root: string; source: string; commit?: string },
  items: Array<{ dir: string; name: string }>,
  destRoot: string,
  opts: ImportOptions,
): ImportResult[] {
  return items.map(({ dir }) =>
    importSkill(
      {
        srcDir: dir,
        repoRoot: co.root,
        source: co.source,
        commit: co.commit,
        tags: opts.tags,
        trusted: opts.trusted,
      },
      destRoot,
      opts.overwrite,
    ),
  );
}

/** Import every eligible skill in a repository (or just `only`). The first
 *  directory to claim a name wins, so translated copies deeper in a repo
 *  don't shadow the original. A remote source needs `opts.commit`; imported
 *  skills are untrusted and carry no tools unless `opts.trusted`. */
export function importRepo(
  src: string,
  destRoot: string,
  opts: ImportOptions = {},
): ImportResult[] {
  const co = checkout(src, { commit: opts.commit, requirePin: true });
  try {
    return importItems(co, candidates(co.root, opts.only), destRoot, opts);
  } finally {
    co.cleanup();
  }
}

/** Like importRepo, but shows the operator what would be imported first.
 *  `confirm` receives the summary and must resolve true to proceed; when it
 *  declines nothing is written and an empty list comes back. */
export async function importRepoConfirmed(
  src: string,
  destRoot: string,
  opts: ImportOptions & { confirm: (summary: string[]) => Promise<boolean> | boolean },
): Promise<{ results: ImportResult[]; summary: string[]; declined: boolean }> {
  const co = checkout(src, { commit: opts.commit, requirePin: true });
  try {
    const items = candidates(co.root, opts.only);
    const summary = describeImport(co.source, co.commit, items, destRoot);
    if (!(await opts.confirm(summary))) return { results: [], summary, declined: true };
    return { results: importItems(co, items, destRoot, opts), summary, declined: false };
  } finally {
    co.cleanup();
  }
}
