#!/usr/bin/env node
/** #594: reviewed refresh of the SDK, lockfile and executable hashes. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SDK = '@anthropic-ai/claude-agent-sdk';
const STABLE = /^\d+\.\d+\.\d+$/;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = 'packages/@monomind/cli';

function compare(a, b) {
  const parts = a.split('.').map(Number);
  const other = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (parts[i] !== other[i]) return parts[i] - other[i];
  return 0;
}

export function assessFreshness(pin, metadata, threshold = 5) {
  const latest = metadata['dist-tags']?.latest;
  if (!STABLE.test(pin) || !STABLE.test(latest)) throw new Error('Expected stable SDK versions');
  if (!metadata.versions?.[pin] || !metadata.versions?.[latest])
    throw new Error('SDK pin/latest not published');
  const behind = Object.keys(metadata.versions).filter(
    (version) => STABLE.test(version) && compare(version, pin) > 0 && compare(version, latest) <= 0,
  ).length;
  return { latest, behind, stale: behind > threshold };
}

/** Replace just the SDK entry, preserving comments and every other package. */
export function replaceSdkObject(source, constant, value) {
  const start = source.indexOf(`export const ${constant}`);
  const key = source.indexOf(`'${SDK}':`, start);
  if (start < 0 || key < 0) throw new Error(`Missing ${constant} SDK entry`);
  const open = source.indexOf('{', key);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let end = open; end < source.length; end++) {
    const ch = source[end];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return source.slice(0, open) + JSON.stringify(value, null, 2) + source.slice(end + 1);
    }
  }
  throw new Error(`Unclosed ${constant} SDK entry`);
}

export async function verifiedTarball(entry, fetcher = fetch) {
  const url = new URL(entry.resolved);
  if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org')
    throw new Error('Expected npm registry tarball');
  const response = await fetcher(url, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
  if (!response.ok) throw new Error(`Tarball download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const valid = entry.integrity?.split(/\s+/).some((sri) => {
    const [algorithm, expected] = sri.split('-', 2);
    return (
      ['sha512', 'sha256'].includes(algorithm) &&
      createHash(algorithm).update(bytes).digest('base64') === expected
    );
  });
  if (!valid) throw new Error(`Tarball integrity mismatch: ${url}`);
  return bytes;
}

function replaceRequired(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Missing ${label}`);
  return source.replace(pattern, replacement);
}

export async function refresh(root, version, { run = execFileSync, fetcher = fetch } = {}) {
  const temp = mkdtempSync(join(tmpdir(), 'monomind-sdk-refresh-'));
  try {
    writeFileSync(
      join(temp, 'package.json'),
      JSON.stringify({
        name: 'monomind-optional-dependency',
        private: true,
        dependencies: { [SDK]: version },
      }),
    );
    run(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--legacy-peer-deps',
        '--ignore-scripts',
        '--registry=https://registry.npmjs.org',
      ],
      { cwd: temp, stdio: 'inherit' },
    );
    const lock = JSON.parse(readFileSync(join(temp, 'package-lock.json'), 'utf8'));
    const sdkEntry = lock.packages[`node_modules/${SDK}`];
    if (sdkEntry?.version !== version) throw new Error('Generated SDK lock version mismatch');
    const pins = { version, entry: null, binaries: {} };
    let nativeVersion;
    for (const name of [SDK, ...Object.keys(sdkEntry.optionalDependencies ?? {})]) {
      if (name !== SDK && !name.startsWith(`${SDK}-`))
        throw new Error(`Unexpected SDK executable package: ${name}`);
      const entry = lock.packages[`node_modules/${name}`];
      if (!entry) throw new Error(`Missing lock entry: ${name}`);
      const archive = join(temp, 'download.tgz');
      writeFileSync(archive, await verifiedTarball(entry, fetcher));
      const file = name === SDK ? 'sdk.mjs' : name.includes('-win32-') ? 'claude.exe' : 'claude';
      const bytes = run('tar', ['-xOzf', archive, `package/${file}`], {
        maxBuffer: 500 * 1024 * 1024,
      });
      const pin = { file, sha256: createHash('sha256').update(bytes).digest('hex') };
      if (name === SDK) pins.entry = pin;
      else pins.binaries[name] = pin;
      if (name === `${SDK}-linux-x64` && process.platform === 'linux' && process.arch === 'x64') {
        const binary = join(temp, 'claude');
        writeFileSync(binary, bytes, { mode: 0o700 });
        const output = run(binary, ['--version'], { encoding: 'utf8', timeout: 30_000 });
        nativeVersion = output.match(/^(\d+\.\d+\.\d+)\s+\(Claude Code\)/)?.[1];
      }
    }
    if (!nativeVersion || !Object.keys(pins.binaries).length)
      throw new Error('Refresh requires Linux x64 to verify bundled Claude version');
    const depsPath = join(root, CLI, 'src/utils/optional-deps.ts');
    const locksPath = join(root, CLI, 'src/utils/optional-deps-locks.ts');
    const sdkPath = join(root, CLI, 'src/orgrt/claude-sdk.ts');
    const manifestPath = join(root, CLI, 'package.json');
    const deps = replaceRequired(
      readFileSync(depsPath, 'utf8'),
      /('@anthropic-ai\/claude-agent-sdk':\s*\{\s*version: ')[^']+(')/,
      `$1${version}$2`,
      'SDK optional pin',
    );
    let locks = replaceSdkObject(
      readFileSync(locksPath, 'utf8'),
      'OPTIONAL_DEPENDENCY_LOCKS',
      lock,
    );
    locks = replaceSdkObject(locks, 'OPTIONAL_DEPENDENCY_CODE_PINS', pins);
    const sdk = replaceRequired(
      readFileSync(sdkPath, 'utf8'),
      /SDK_BUNDLED_CLAUDE_VERSION = '[^']+'/g,
      `SDK_BUNDLED_CLAUDE_VERSION = '${nativeVersion}'`,
      'bundled version',
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.devDependencies[SDK] = version;
    if (manifest.peerDependencies?.[SDK]) manifest.peerDependencies[SDK] = version;
    if (manifest.pnpm?.overrides?.[SDK]) manifest.pnpm.overrides[SDK] = version;
    for (const [path, content] of [
      [depsPath, deps],
      [locksPath, locks],
      [sdkPath, sdk],
      [manifestPath, `${JSON.stringify(manifest, null, 2)}\n`],
    ])
      writeFileSync(path, content);
    console.log(`Updated SDK to ${version}, verified bundled Claude Code ${nativeVersion}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const update = args.includes('--update');
  const strict = args.includes('--strict');
  const thresholdArg = args.indexOf('--max-behind');
  const threshold = thresholdArg < 0 ? 5 : Number(args[thresholdArg + 1]);
  if (!Number.isInteger(threshold) || threshold < 0)
    throw new Error('--max-behind requires a nonnegative integer');
  const source = readFileSync(join(ROOT, CLI, 'src/utils/optional-deps.ts'), 'utf8');
  const pin = source.match(/'@anthropic-ai\/claude-agent-sdk':\s*\{\s*version: '([^']+)'/)?.[1];
  const response = await fetch('https://registry.npmjs.org/@anthropic-ai%2fclaude-agent-sdk', {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`SDK registry lookup failed: ${response.status}`);
  const result = assessFreshness(pin, await response.json(), threshold);
  console.log(
    `Claude SDK ${pin}; npm latest ${result.latest}; ${result.behind} stable releases behind (limit ${threshold})`,
  );
  if (update && compare(result.latest, pin) > 0) await refresh(ROOT, result.latest);
  else if (result.stale) {
    console.warn(
      `::warning::Claude SDK is ${result.behind} stable releases behind npm; run the Claude SDK refresh workflow and review its PR.`,
    );
    if (strict) process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`Claude SDK maintenance failed: ${error.message}`);
    process.exitCode = 1;
  });
}
