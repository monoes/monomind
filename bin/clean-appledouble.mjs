#!/usr/bin/env node
// postinstall: delete macOS AppleDouble files (._*) under node_modules.
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.name.startsWith('._')) {
      try {
        rmSync(full, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    } else if (e.isDirectory()) {
      walk(full);
    }
  }
}

if (process.platform !== 'win32') {
  const root = join(process.cwd(), 'node_modules');
  if (existsSync(root)) walk(root);
}
