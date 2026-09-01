#!/usr/bin/env node
/**
 * Vendors the tree-sitter WASM grammars used by @monoes/monograph into
 * `wasm/` and regenerates `wasm/manifest.json`.
 *
 * Why: monograph runs grammars through web-tree-sitter (WASM) instead of the
 * native node binding, so installs need no node-gyp/prebuilds and are immune
 * to ABI mismatches (issue #219's dependency angle). The published tarball
 * ships these wasm files under dist/, making the package fully self-contained.
 *
 * Strategies:
 * - copy: the grammar's npm package ships a prebuilt .wasm — copy it, keeping
 *   the wasm version-locked to the grammar package we depend on.
 * - build: the npm package has no wasm (dart, kotlin, swift, vue) but ships
 *   grammar source. Compile with `tree-sitter build --wasm` (devDependency
 *   tree-sitter-cli). A minimal tree-sitter.json is synthesized for grammar
 *   packages that predate that manifest.
 *
 * Usage (from packages/@monomind/monograph):
 *   node scripts/refresh-wasm.mjs
 *
 * Run after bumping any tree-sitter-* or tree-sitter-cli devDependency.
 */
import { copyFileSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(scriptDir, '..');
const wasmDir = join(pkgDir, 'wasm');

// config name → source. `copy` reads <wasm> from the root of npm package
// `from`; `build` compiles the grammar source inside package `from`.
const GRAMMARS = {
  c: { strategy: 'copy', file: 'tree-sitter-c.wasm', from: 'tree-sitter-c' },
  cpp: { strategy: 'copy', file: 'tree-sitter-cpp.wasm', from: 'tree-sitter-cpp' },
  csharp: { strategy: 'copy', file: 'tree-sitter-c_sharp.wasm', from: 'tree-sitter-c-sharp' },
  dart: {
    strategy: 'build',
    file: 'tree-sitter-dart.wasm',
    from: 'tree-sitter-dart',
    treeSitterJson: {
      name: 'dart',
      camelcase: 'Dart',
      scope: 'source.dart',
      fileTypes: ['dart'],
    },
  },
  go: { strategy: 'copy', file: 'tree-sitter-go.wasm', from: 'tree-sitter-go' },
  java: { strategy: 'copy', file: 'tree-sitter-java.wasm', from: 'tree-sitter-java' },
  kotlin: {
    strategy: 'build',
    file: 'tree-sitter-kotlin.wasm',
    from: 'tree-sitter-kotlin',
    treeSitterJson: {
      name: 'kotlin',
      camelcase: 'Kotlin',
      scope: 'source.kotlin',
      fileTypes: ['kt', 'kts'],
    },
  },
  php: { strategy: 'copy', file: 'tree-sitter-php.wasm', from: 'tree-sitter-php' },
  python: { strategy: 'copy', file: 'tree-sitter-python.wasm', from: 'tree-sitter-python' },
  ruby: { strategy: 'copy', file: 'tree-sitter-ruby.wasm', from: 'tree-sitter-ruby' },
  rust: { strategy: 'copy', file: 'tree-sitter-rust.wasm', from: 'tree-sitter-rust' },
  swift: { strategy: 'build', file: 'tree-sitter-swift.wasm', from: 'tree-sitter-swift' },
  typescript: {
    strategy: 'copy',
    file: 'tree-sitter-typescript.wasm',
    from: 'tree-sitter-typescript',
  },
  tsx: { strategy: 'copy', file: 'tree-sitter-tsx.wasm', from: 'tree-sitter-typescript' },
  // NOTE: vue is intentionally absent. tree-sitter-vue's external scanner
  // requires emscripten to build for wasm (unsupported by tree-sitter-cli's
  // built-in wasm backend), and its extraction config is TypeScript-typed
  // anyway — .vue files are handled by extracting the <script> block and
  // parsing it with the TS/TSX grammar (see vue.ts / loader.ts).
};

function packageDir(pkg) {
  return dirname(require.resolve(`${pkg}/package.json`));
}

function packageVersion(pkg) {
  return require(`${pkg}/package.json`).version;
}

// tree-sitter-cli ships a bin shim; invoking its cli.js with node avoids
// relying on the pnpm .bin layout (works from plain `node scripts/...`).
function treeSitterCli() {
  return require.resolve('tree-sitter-cli/cli.js');
}

function synthesizeTreeSitterJson(dir, spec) {
  const config = {
    $schema: 'https://tree-sitter.github.io/tree-sitter/assets/schemas/config.schema.json',
    grammars: [
      {
        name: spec.treeSitterJson.name,
        camelcase: spec.treeSitterJson.camelcase,
        scope: spec.treeSitterJson.scope,
        path: '.',
        'file-types': spec.treeSitterJson.fileTypes,
      },
    ],
    metadata: {
      version: packageVersion(spec.from),
      license: 'MIT',
      description: `${spec.treeSitterJson.camelcase} grammar for tree-sitter`,
      links: { repository: 'https://github.com/tree-sitter/tree-sitter' },
    },
    bindings: { c: true, go: true, node: true, python: true, rust: true, swift: true },
  };
  writeFileSync(join(dir, 'tree-sitter.json'), `${JSON.stringify(config, null, 2)}\n`);
}

mkdirSync(wasmDir, { recursive: true });

const manifest = {};
let failures = 0;

for (const [name, spec] of Object.entries(GRAMMARS)) {
  try {
    const dir = packageDir(spec.from);

    if (spec.strategy === 'copy') {
      const src = join(dir, spec.file);
      if (!existsSync(src)) {
        throw new Error(`${spec.file} not found inside ${spec.from}`);
      }
      copyFileSync(src, join(wasmDir, spec.file));
    } else {
      const configPath = join(dir, 'tree-sitter.json');
      const synthesized = !existsSync(configPath);
      if (synthesized) synthesizeTreeSitterJson(dir, spec);
      try {
        execFileSync(process.execPath, [treeSitterCli(), 'build', '--wasm'], {
          cwd: dir,
          stdio: 'pipe',
        });
      } finally {
        // Never leave a synthesized manifest behind in node_modules.
        if (synthesized) unlinkSync(configPath);
      }
      const built = join(dir, spec.file);
      if (!existsSync(built)) {
        throw new Error(`tree-sitter build --wasm did not produce ${spec.file}`);
      }
      copyFileSync(built, join(wasmDir, spec.file));
    }

    manifest[name] = {
      file: spec.file,
      source: `${spec.from}@${packageVersion(spec.from)}${spec.strategy === 'build' ? ' (built from source)' : ''}`,
    };
    console.log(`✓ ${name}: ${spec.file} (${manifest[name].source})`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name}: ${err.message}`);
  }
}

writeFileSync(join(wasmDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

if (failures > 0) {
  console.error(`\n${failures} grammar(s) failed — wasm/ is incomplete`);
  process.exit(1);
}
console.log(`\nwasm/ refreshed: ${Object.keys(manifest).length} grammars`);
