/**
 * Monorepo-wide guard: no publishable package may ship a stale `dist/`.
 *
 * ## The failure this pins
 *
 * `@monoes/routing@1.0.1` shipped a dist that was SEVEN DAYS older than its
 * source. Nothing was broken in the usual sense — `npm run build` ran, `tsc`
 * exited 0, `npm publish` succeeded. The build simply emitted nothing.
 *
 * Every package here compiles with `composite: true` (which implies
 * `incremental`), so `tsc` writes a `tsconfig.tsbuildinfo` next to the
 * tsconfig and consults it on the next run. That file records what tsc
 * believes it already emitted. It does NOT record whether those outputs still
 * exist on disk. If `dist/` is wiped, partially wiped, or was produced by a
 * different checkout, tsc reads the buildinfo, concludes there is nothing to
 * do, prints nothing, and exits 0. The emit never happens.
 *
 * That behaviour is reproduced from first principles in the
 * "tsbuildinfo no-op hazard" block below, so the premise of this guard is
 * pinned rather than asserted from memory.
 *
 * ## Why this is a config guard and not an mtime comparison
 *
 * `dist/` is gitignored in every package (root .gitignore:162, plus the CLI's
 * own .gitignore:20), so there is no committed build output to compare mtimes
 * against. The only thing under version control that can go wrong is the
 * publish pipeline itself. So the guard checks the pipeline: every package
 * that ships a compiled `dist/` must have a `prepublishOnly` that reaches a
 * compiler, and — because they are all incremental — must delete the
 * buildinfo (and the stale dist) before that compiler runs.
 *
 * ## Scope note
 *
 * `@monoes/monodesign` is publishable but ships TypeScript source directly
 * (`main: ./src/index.ts`, `files: [cli/, skill/, src/, NOTICE.md]`) and has no
 * tsconfig.json at all. It has no dist to go stale, and the guard asserts that
 * exemption explicitly rather than hardcoding a skip — if it ever starts
 * shipping a dist, this test starts requiring a build.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Every package in this repo that gets `npm publish`ed.
 * `dir` is relative to the repo root; '.' is the `monomind` umbrella package.
 */
const PUBLISHABLE = [
  '.',
  'packages/@monomind/cli',
  'packages/@monomind/mcp',
  'packages/@monomind/memory',
  'packages/@monomind/monograph',
  'packages/@monomind/hooks',
  'packages/@monomind/routing',
  'packages/monofence-ai',
  'packages/@monoes/monobrowse',
  'packages/@monoes/monodesign',
];

type Pkg = {
  name: string;
  version?: string;
  private?: boolean;
  main?: string;
  files?: string[];
  scripts?: Record<string, string>;
};

function readPkg(dir: string): Pkg {
  return JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'));
}

/** Does this package's published tarball contain compiled output from a `dist/` dir? */
export function shipsCompiledDist(pkg: Pkg): boolean {
  const files = pkg.files;
  if (Array.isArray(files)) {
    // Ignore negated patterns ("!dist/**/*.test.js") — they subtract, never add.
    return files.some((f) => !f.startsWith('!') && /(^|\/)dist(\/|$)/.test(f));
  }
  // No `files` field: npm ships everything not gitignored, and `main` tells us
  // whether the entry point is compiled.
  return typeof pkg.main === 'string' && pkg.main.replace(/^\.\//, '').startsWith('dist/');
}

/**
 * Expand a shell command into the full sequence npm would actually run,
 * inlining `npm run X` into npm's implicit `preX && X && postX` chain.
 *
 * `resolveForeign` handles the umbrella package, whose publish step is
 * `cd packages/@monomind/cli && npm run build` — a script in a *different*
 * package.json. Without it the umbrella would look like it never compiles.
 */
export function expandScript(
  cmd: string,
  scripts: Record<string, string>,
  resolveForeign: (dir: string) => Record<string, string> | undefined = () => undefined,
  depth = 0,
): string {
  if (depth > 6) return cmd;

  // `cd <dir> && npm run <name>` -> expand <name> against <dir>'s scripts.
  const foreign = cmd.match(/cd\s+([^\s&|;]+)\s*&&\s*npm\s+run\s+([\w:-]+)/);
  if (foreign) {
    const foreignScripts = resolveForeign(foreign[1]);
    if (foreignScripts) {
      const inner = expandScript(
        `npm run ${foreign[2]}`,
        foreignScripts,
        resolveForeign,
        depth + 1,
      );
      return cmd.replace(foreign[0], inner);
    }
  }

  return cmd.replace(/npm\s+run\s+([\w:-]+)/g, (_m, name: string) => {
    const chain = [`pre${name}`, name, `post${name}`]
      .map((k) => scripts[k])
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .map((v) => expandScript(v, scripts, resolveForeign, depth + 1));
    return chain.length ? chain.join(' && ') : `npm run ${name}`;
  });
}

/** Does the expanded command actually invoke a TypeScript compile? */
export function invokesCompiler(expanded: string): boolean {
  return /(^|[\s&|;(])(npx\s+)?tsc(\s|$)/.test(expanded);
}

/**
 * Does the expanded command wipe the incremental buildinfo before compiling?
 *
 * Two spellings count, because the build scripts stopped being shell. They used
 * POSIX `rm` directly, which cmd.exe does not understand, so npm could not build
 * this repo on Windows at all; they now call scripts/build-fs.mjs. The hazard is
 * identical either way — a surviving tsconfig.tsbuildinfo makes tsc a silent
 * no-op — so this guard has to recognise both, or it goes quietly blind at the
 * exact moment the scripts change. That is not hypothetical: matching only the
 * `rm` spelling is what made every package fail this check the first time the
 * portable form landed, despite the behaviour being unchanged.
 */
export function clearsBuildInfo(expanded: string): boolean {
  const clear = expanded.search(
    /(?:rm\s+-[a-zA-Z]*f[a-zA-Z]*|build-fs\.mjs\s+clean)\s+[^&|;]*tsconfig\.tsbuildinfo/,
  );
  if (clear === -1) return false;
  const compile = expanded.search(/(^|[\s&|;(])(npx\s+)?tsc(\s|$)/);
  return compile === -1 || clear < compile;
}

/**
 * Does a package's tsconfig turn on incremental compilation, directly or via
 * `composite`, in its own file or anywhere up its `extends` chain?
 *
 * Following `extends` is not optional. Most packages here set neither flag
 * locally — both `composite: true` and `incremental: true` live in
 * packages/tsconfig.base.json. A version of this check that only read the
 * package's own tsconfig.json reported @monoes/routing as non-incremental,
 * i.e. it silently exempted the exact package whose stale 1.0.1 dist started
 * all this.
 */
export function usesIncrementalBuild(tsconfigPath: string, depth = 0): boolean {
  if (depth > 8 || !existsSync(tsconfigPath)) return false;
  const raw = readFileSync(tsconfigPath, 'utf8');
  if (/"(composite|incremental)"\s*:\s*true/.test(raw)) return true;
  const ext = raw.match(/"extends"\s*:\s*"([^"]+)"/);
  if (!ext) return false;
  return usesIncrementalBuild(join(dirname(tsconfigPath), ext[1]), depth + 1);
}

function packageUsesIncrementalBuild(dir: string): boolean {
  return usesIncrementalBuild(join(REPO_ROOT, dir, 'tsconfig.json'));
}

// ---------------------------------------------------------------------------
// The hazard itself, reproduced. If TypeScript ever stops behaving this way,
// this block fails and the rest of the guard can be reconsidered.
// ---------------------------------------------------------------------------

describe('tsbuildinfo no-op hazard', () => {
  const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

  function scaffold(): string {
    const dir = mkdtempSync(join(tmpdir(), 'tsbuildinfo-hazard-'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'es2022',
          module: 'esnext',
          moduleResolution: 'bundler',
          outDir: './dist',
          rootDir: './src',
          composite: true,
          declaration: true,
        },
        include: ['src/**/*.ts'],
      }),
    );
    return dir;
  }

  function build(dir: string): void {
    execFileSync(TSC, [], { cwd: dir, stdio: 'pipe' });
  }

  it('leaves a deleted dist file missing when tsconfig.tsbuildinfo survives', () => {
    const dir = scaffold();
    try {
      build(dir);
      expect(existsSync(join(dir, 'dist', 'a.js'))).toBe(true);
      expect(existsSync(join(dir, 'tsconfig.tsbuildinfo'))).toBe(true);

      rmSync(join(dir, 'dist', 'a.js'));
      build(dir); // exits 0, prints nothing, emits nothing

      expect(existsSync(join(dir, 'dist', 'a.js'))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('regenerates the deleted dist file once tsconfig.tsbuildinfo is removed', () => {
    const dir = scaffold();
    try {
      build(dir);
      rmSync(join(dir, 'dist', 'a.js'));
      rmSync(join(dir, 'tsconfig.tsbuildinfo')); // the guard this repo now applies
      build(dir);

      expect(existsSync(join(dir, 'dist', 'a.js'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Analyzer self-tests: prove the assertions below can distinguish a guarded
// pipeline from an unguarded one, independently of the repo's current state.
// ---------------------------------------------------------------------------

describe('publish-pipeline analyzer', () => {
  it('inlines npm run into npm\'s implicit pre/post chain', () => {
    const scripts = { prebuild: 'rm -rf dist tsconfig.tsbuildinfo', build: 'tsc' };
    expect(expandScript('npm run build', scripts)).toBe('rm -rf dist tsconfig.tsbuildinfo && tsc');
  });

  it('crosses a package boundary for `cd <dir> && npm run build`', () => {
    const foreign = { prebuild: 'rm -rf dist tsconfig.tsbuildinfo', build: 'tsc' };
    const expanded = expandScript(
      'cd packages/@monomind/cli && npm run build',
      {},
      (d) => (d === 'packages/@monomind/cli' ? foreign : undefined),
    );
    expect(invokesCompiler(expanded)).toBe(true);
    expect(clearsBuildInfo(expanded)).toBe(true);
  });

  it('rejects a build that compiles without clearing the buildinfo', () => {
    const expanded = expandScript('npm run build', { build: 'tsc' });
    expect(invokesCompiler(expanded)).toBe(true);
    expect(clearsBuildInfo(expanded)).toBe(false);
  });

  it('rejects a buildinfo removal that happens AFTER the compile', () => {
    expect(clearsBuildInfo('tsc && rm -f tsconfig.tsbuildinfo')).toBe(false);
    expect(clearsBuildInfo('rm -f tsconfig.tsbuildinfo && tsc')).toBe(true);
  });

  // The build scripts are no longer shell — they call scripts/build-fs.mjs so
  // that npm can build this repo on Windows, where cmd.exe rejects POSIX `rm`.
  // These cases pin the portable spelling to the same rules as the `rm` one,
  // including the ordering requirement, so the guard cannot be satisfied by a
  // clean that happens too late.
  it('accepts the portable build-fs clean, under the same ordering rule', () => {
    const clean = 'node ../../../scripts/build-fs.mjs clean dist tsconfig.tsbuildinfo';
    expect(clearsBuildInfo(`${clean} && tsc`)).toBe(true);
    expect(clearsBuildInfo(`tsc && ${clean}`)).toBe(false);
  });

  it('matches the real prebuild-then-build chain used by the packages', () => {
    const expanded = expandScript('npm run build', {
      prebuild: 'node ../../../scripts/build-fs.mjs clean dist tsconfig.tsbuildinfo',
      build: 'tsc',
    });
    expect(invokesCompiler(expanded)).toBe(true);
    expect(clearsBuildInfo(expanded)).toBe(true);
  });

  it('does not accept a build-fs clean that spares the buildinfo', () => {
    // Cleaning only dist is the exact hazard this guard exists for: tsc sees a
    // surviving buildinfo, decides everything is current, and emits nothing.
    expect(
      clearsBuildInfo('node ../../../scripts/build-fs.mjs clean dist && tsc'),
    ).toBe(false);
  });

  it('rejects a prepublishOnly that never reaches a compiler', () => {
    const expanded = expandScript('npm run prepublishOnly', {
      prepublishOnly: 'cp ../../README.md ./README.md',
    });
    expect(invokesCompiler(expanded)).toBe(false);
  });

  it('does not mistake "tsc" inside a longer word for a compiler call', () => {
    expect(invokesCompiler('node scripts/tsconfig-check.mjs')).toBe(false);
    expect(invokesCompiler('echo notsc')).toBe(false);
    expect(invokesCompiler('rm -f tsconfig.tsbuildinfo && tsc')).toBe(true);
  });

  it('detects incremental compilation inherited through `extends`', () => {
    // Real files: routing's own tsconfig sets neither flag; the base does.
    const own = readFileSync(
      join(REPO_ROOT, 'packages/@monomind/routing/tsconfig.json'),
      'utf8',
    );
    expect(/"(composite|incremental)"\s*:\s*true/.test(own)).toBe(false);
    expect(usesIncrementalBuild(join(REPO_ROOT, 'packages/@monomind/routing/tsconfig.json'))).toBe(
      true,
    );
    expect(usesIncrementalBuild(join(REPO_ROOT, 'packages/@monomind/does-not-exist/tsconfig.json'))).toBe(
      false,
    );
  });

  it('classifies dist-shipping vs source-shipping packages', () => {
    expect(shipsCompiledDist({ name: 'a', files: ['dist', 'README.md'] })).toBe(true);
    expect(shipsCompiledDist({ name: 'b', files: ['packages/x/dist/**/*.js'] })).toBe(true);
    expect(shipsCompiledDist({ name: 'c', files: ['src/', 'cli/'] })).toBe(false);
    expect(shipsCompiledDist({ name: 'd', files: ['!dist/**/*.test.js', 'src/'] })).toBe(false);
    expect(shipsCompiledDist({ name: 'e', main: 'dist/src/index.js' })).toBe(true);
    expect(shipsCompiledDist({ name: 'f', main: './src/index.ts' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The guard proper.
// ---------------------------------------------------------------------------

describe('publishable packages cannot ship a stale dist', () => {
  const resolveForeign = (dir: string): Record<string, string> | undefined => {
    const p = join(REPO_ROOT, dir, 'package.json');
    if (!existsSync(p)) return undefined;
    return (JSON.parse(readFileSync(p, 'utf8')) as Pkg).scripts ?? {};
  };

  // Sanity: the list above must not silently shrink to nothing, and must
  // actually contain dist-shipping packages — otherwise every assertion below
  // would vacuously pass.
  it('covers the packages that actually ship compiled output', () => {
    expect(PUBLISHABLE.length).toBeGreaterThanOrEqual(10);
    const dist = PUBLISHABLE.filter((d) => shipsCompiledDist(readPkg(d)));
    expect(dist.length).toBeGreaterThanOrEqual(9);
    expect(dist).toContain('.');
    expect(dist).toContain('packages/@monomind/cli');
  });

  for (const dir of PUBLISHABLE) {
    const pkg = readPkg(dir);
    const label = `${pkg.name} (${dir})`;

    if (!shipsCompiledDist(pkg)) {
      it(`${label} ships source, not a dist — nothing to go stale`, () => {
        // Pin the exemption: if it starts shipping a dist, this fails and the
        // package falls under the rules below.
        expect(shipsCompiledDist(pkg)).toBe(false);
        expect(packageUsesIncrementalBuild(dir)).toBe(false);
      });
      continue;
    }

    it(`${label} rebuilds from scratch on publish`, () => {
      const scripts = pkg.scripts ?? {};
      expect(
        scripts.prepublishOnly,
        `${pkg.name} ships dist/ but has no prepublishOnly — \`npm publish\` would ` +
          `tarball whatever happens to be on disk.`,
      ).toBeTruthy();

      const expanded = expandScript(
        scripts.prepublishOnly as string,
        scripts,
        resolveForeign,
      );

      expect(
        invokesCompiler(expanded),
        `${pkg.name}'s prepublishOnly never reaches tsc. Expanded to: ${expanded}`,
      ).toBe(true);

      if (packageUsesIncrementalBuild(dir)) {
        expect(
          clearsBuildInfo(expanded),
          `${pkg.name} compiles with composite/incremental, so a surviving ` +
            `tsconfig.tsbuildinfo makes tsc a silent no-op (exit 0, no emit). ` +
            `Its publish path must \`rm -f tsconfig.tsbuildinfo\` (or ` +
            `\`rm -rf dist tsconfig.tsbuildinfo\` in prebuild) before tsc. ` +
            `Expanded to: ${expanded}`,
        ).toBe(true);
      }
    });
  }
});

/**
 * The same hazard, from the other direction: a tsconfig.tsbuildinfo that is
 * committed rather than merely left lying around.
 *
 * The guards above check that each publish path DELETES the buildinfo before
 * compiling. That is defeated if the file is tracked, because then every fresh
 * clone — including CI and any release cut from one — starts with someone
 * else's incremental state. .gitignore already lists *.tsbuildinfo, but
 * gitignore does not apply to files that are already tracked, so one committed
 * before the rule stays committed and silently churns in unrelated diffs.
 *
 * @monoes/routing 1.0.1 shipped a seven-day-stale dist for exactly this reason:
 * a surviving buildinfo made tsc a no-op that still exited 0.
 */
describe('no build state is committed', () => {
  it('no tsconfig.tsbuildinfo is tracked in git', () => {
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .filter((f) => f.endsWith('.tsbuildinfo'));

    expect(
      tracked,
      'A committed tsbuildinfo hands every fresh clone stale incremental state, ' +
      'which makes tsc skip emitting while still exiting 0. Run ' +
      '`git rm --cached <file>` — .gitignore already covers the path, but that ' +
      'has no effect on an already-tracked file.',
    ).toEqual([]);
  });
});
