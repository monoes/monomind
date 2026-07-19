#!/usr/bin/env node
/**
 * Build the browser anti-pattern detector bundle.
 *
 * Concatenates the pure detection modules and the browser-injected UI into a
 * single IIFE that runs in any page (detector page, live overlay, extension).
 * Imports/exports are stripped because the bundle is a flat script, not a
 * module. From the registry only the `ANTIPATTERNS` array literal is inlined
 * (the browser path never uses the registry helper functions).
 *
 * Output: cli/engine/detect-antipatterns-browser.js
 *
 * Run: node scripts/build-browser-detector.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const engineDir = path.join(pkgRoot, 'cli', 'engine');

// Source modules, in inline order. Each entry names the module and how to
// transform its raw source into flat script text.
const MODULES = [
  { rel: 'shared/constants.mjs', transform: stripImportsExports },
  { rel: 'registry/antipatterns.mjs', transform: extractAntipatternsArray },
  { rel: 'shared/color.mjs', transform: stripImportsExports },
  { rel: 'shared/fonts.mjs', transform: stripImportsExports },
  { rel: 'rules/checks.mjs', transform: stripImportsExports },
  { rel: 'browser/injected/index.mjs', transform: stripImportsExports },
];

const HEADER = `/**
 * Anti-Pattern Browser Detector for Monodesign
 * Copyright (c) 2026 Paul Bakaus
 * SPDX-License-Identifier: Apache-2.0
 *
 * GENERATED -- do not edit. Source: cli/engine/browser/injected/index.mjs
 * Rebuild: node scripts/build-browser-detector.js
 *
 * Usage: <script src="detect-antipatterns-browser.js"></script>
 * Re-scan: window.monodesignScan()
 */
(function () {
if (typeof window === 'undefined') return;
`;

// Remove leading `import ... from '...';` statements (single- and multi-line)
// and any `export { ... };` blocks / `export ` declaration prefixes. Leaves a
// clean flat-script body with a single leading + trailing newline trimmed.
function stripImportsExports(src) {
  let out = src;
  // Multi-line or single-line import blocks.
  out = out.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\n/gm, '');
  out = out.replace(/^import\s+['"][^'"]+['"];?\n/gm, '');
  // Trailing (or inline) `export { ... };` blocks.
  out = out.replace(/^export\s*\{[\s\S]*?\};?\n?/gm, '');
  // `export const/function/class ...` → strip the keyword only.
  out = out.replace(/^export\s+(?=(const|let|var|function|class|async)\b)/gm, '');
  return trimBlankEdges(out);
}

// From the registry module, inline ONLY the `const ANTIPATTERNS = [ ... ];`
// array literal — the browser bundle never calls the helper functions.
function extractAntipatternsArray(src) {
  const start = src.indexOf('const ANTIPATTERNS = [');
  if (start === -1) throw new Error('ANTIPATTERNS array not found in registry');
  // First line that is exactly `];` closes the array.
  const closeRe = /\n\];\n/g;
  closeRe.lastIndex = start;
  const m = closeRe.exec(src);
  if (!m) throw new Error('ANTIPATTERNS array close not found');
  const end = m.index + m[0].length; // include the `];\n`
  return trimBlankEdges(src.slice(start, end));
}

function trimBlankEdges(text) {
  return text.replace(/^\n+/, '').replace(/\n+$/, '');
}

let output = HEADER;
for (const mod of MODULES) {
  const abs = path.join(engineDir, mod.rel);
  const raw = fs.readFileSync(abs, 'utf-8');
  const body = mod.transform(raw);
  output += `// --- cli/engine/${mod.rel} ---\n${body}\n\n`;
}
output += '})();\n';

const outPath = path.join(engineDir, 'detect-antipatterns-browser.js');
fs.writeFileSync(outPath, output);
console.log(`Wrote ${outPath} (${output.split('\n').length} lines)`);
