#!/usr/bin/env node
/**
 * Dependency-override guard: `pnpm-workspace.yaml` is the single source of truth.
 *
 * pnpm v10 reads workspace-level overrides ONLY from `pnpm-workspace.yaml`. An
 * `overrides` (or yarn's `resolutions`) block in any package.json in this repo
 * is therefore never applied:
 *
 *   - root package.json  — pnpm ignores it; only a bare `npm install` at the
 *     repo root would honour it, which is not how this repo is installed.
 *   - a package's own package.json — ignored by pnpm for the same reason, and
 *     npm ignores a dependency's overrides when installing it as a dependency.
 *
 * Dead blocks are worse than no blocks: they read as protection. Issue #284 —
 * root carried 18 entries that had silently diverged from the 29 that actually
 * applied, and the CLI carried one that applied nowhere at all. Issue #266 lost
 * real investigation time to exactly that confusion.
 *
 * So: fail on any such block, and say per entry whether pnpm-workspace.yaml
 * already covers it, disagrees with it, or has never heard of it.
 *
 * Usage: node scripts/check-overrides-source.mjs [--root <dir>]
 * (--root exists so the tests can point it at a fixture repo.)
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Parse the top-level `overrides:` map out of pnpm-workspace.yaml. */
export function parseWorkspaceOverrides(yamlText) {
  const overrides = {};
  let inside = false;
  for (const line of yamlText.split('\n')) {
    if (/^overrides:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break; // next top-level key ends the block
    const match = line.match(/^\s+(?:'([^']+)'|"([^"]+)"|([^\s:]+))\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const name = match[1] ?? match[2] ?? match[3];
    overrides[name] = match[4].replace(/^['"]|['"]$/g, '');
  }
  return overrides;
}

/** Resolve the `packages:` globs (literal segments plus `*`) to directories. */
export function resolveWorkspacePackageDirs(root, yamlText) {
  const patterns = [];
  let inside = false;
  for (const line of yamlText.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) continue;
    if (/^\S/.test(line)) break;
    const match = line.match(/^\s+-\s*(?:'([^']+)'|"([^"]+)"|(\S+))\s*$/);
    if (match) patterns.push((match[1] ?? match[2] ?? match[3]).replace(/\/+$/, ''));
  }

  const dirs = new Set();
  for (const pattern of patterns) {
    let candidates = [root];
    for (const segment of pattern.split('/')) {
      const next = [];
      for (const base of candidates) {
        if (segment === '*') {
          if (!existsSync(base)) continue;
          for (const entry of readdirSync(base)) {
            const full = join(base, entry);
            if (statSync(full).isDirectory()) next.push(full);
          }
        } else {
          const full = join(base, segment);
          if (existsSync(full) && statSync(full).isDirectory()) next.push(full);
        }
      }
      candidates = next;
    }
    for (const dir of candidates) dirs.add(dir);
  }
  return [...dirs].sort();
}

/**
 * @returns {{problems: string[], scanned: number, workspaceCount: number}}
 */
export function checkOverrideSource(root) {
  const workspaceFile = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) {
    return {
      problems: [`pnpm-workspace.yaml not found at ${root} — cannot verify override sourcing`],
      scanned: 0,
      workspaceCount: 0,
    };
  }
  const yamlText = readFileSync(workspaceFile, 'utf8');
  const workspace = parseWorkspaceOverrides(yamlText);

  const manifests = [join(root, 'package.json')];
  for (const dir of resolveWorkspacePackageDirs(root, yamlText)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) manifests.push(manifest);
  }

  const problems = [];
  for (const manifest of manifests) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    } catch (err) {
      problems.push(`${relative(root, manifest)}: not valid JSON (${err.message})`);
      continue;
    }
    for (const field of ['overrides', 'resolutions']) {
      const block = pkg[field];
      if (!block || Object.keys(block).length === 0) continue;
      const where = relative(root, manifest) || 'package.json';
      const lines = [
        `${where} declares "${field}" — pnpm never applies it (workspace overrides come ` +
          `from pnpm-workspace.yaml). Per entry:`,
      ];
      for (const [name, range] of Object.entries(block)) {
        if (!(name in workspace)) {
          lines.push(
            `  - ${name}@${range}: NOT in pnpm-workspace.yaml — this constraint is applied ` +
              `nowhere. Add it to pnpm-workspace.yaml overrides, then delete it here.`,
          );
        } else if (workspace[name] !== range) {
          lines.push(
            `  - ${name}@${range}: DISAGREES with pnpm-workspace.yaml (${workspace[name]}), ` +
              `which is what pnpm applies. Reconcile there — never weaken it — then delete it here.`,
          );
        } else {
          lines.push(
            `  - ${name}@${range}: already identical in pnpm-workspace.yaml — delete it here.`,
          );
        }
      }
      problems.push(lines.join('\n'));
    }
  }

  return { problems, scanned: manifests.length, workspaceCount: Object.keys(workspace).length };
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const rootFlag = process.argv.indexOf('--root');
  const root =
    rootFlag === -1
      ? join(dirname(fileURLToPath(import.meta.url)), '..')
      : process.argv[rootFlag + 1];

  const { problems, scanned, workspaceCount } = checkOverrideSource(root);
  if (problems.length) {
    console.error('\n✗ dependency overrides are not sourced from pnpm-workspace.yaml:\n');
    for (const p of problems) console.error(`    ${p.replace(/\n/g, '\n    ')}\n`);
    console.error(
      '  pnpm-workspace.yaml is the single source of truth for overrides in this repo.\n' +
        '  A block in package.json is dead weight that reads as protection (#284).\n',
    );
    process.exit(1);
  }
  console.log(
    `✓ overrides sourced only from pnpm-workspace.yaml (${workspaceCount} entries; ` +
      `${scanned} package.json files clean)`,
  );
}
