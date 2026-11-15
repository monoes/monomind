import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MARKER = '.source-build';

function newestMtimeMs(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtimeMs(path));
    else if (entry.isFile()) newest = Math.max(newest, statSync(path).mtimeMs);
  }
  return newest;
}

export function writeSourceBuildMarker(packageRoot) {
  const source = join(packageRoot, 'src');
  if (!existsSync(source)) return;
  const dist = join(packageRoot, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, MARKER), JSON.stringify({ sourceMtimeMs: newestMtimeMs(source) }));
}

export function assertSourceBuildFresh(packageRoot) {
  const source = join(packageRoot, 'src');
  if (!existsSync(source)) return;
  const marker = join(packageRoot, 'dist', MARKER);
  let sourceMtimeMs = 0;
  try {
    sourceMtimeMs = JSON.parse(readFileSync(marker, 'utf8')).sourceMtimeMs;
  } catch {
    // The error below covers both a missing marker and one a partial build left unreadable.
  }
  const newest = newestMtimeMs(source);
  if (typeof sourceMtimeMs !== 'number' || sourceMtimeMs < newest) {
    throw new Error(
      '[monomind] This source checkout has a stale or missing CLI build. ' +
        'Run `pnpm --filter @monoes/monomindcli build` before using bin/cli.js.',
    );
  }
}
