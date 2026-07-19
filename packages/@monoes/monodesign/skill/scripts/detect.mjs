#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Packaged fallback: resolve the engine from an installed @monoes/monodesign.
function packagedDetectorPath() {
  try {
    return createRequire(import.meta.url).resolve('@monoes/monodesign/engine');
  } catch {
    return null;
  }
}

const candidates = [
  path.join(__dirname, 'detector', 'detect-antipatterns.mjs'),
  path.join(__dirname, '..', '..', 'cli', 'engine', 'detect-antipatterns.mjs'),
  packagedDetectorPath(),
].filter(Boolean);
const detectorPath = candidates.find(p => fs.existsSync(p));

if (!detectorPath) {
  process.stderr.write('Error: bundled detector not found.\n');
  process.exit(1);
}

const { detectCli } = await import(pathToFileURL(detectorPath));

await detectCli();
