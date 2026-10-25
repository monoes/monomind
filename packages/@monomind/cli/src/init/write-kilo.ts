/**
 * Kilo mesh plugin: `.kilo/plugin/monomind-mesh.js`. Written only for a project that already uses
 * Kilo (a `.kilo` or `.kilocode` directory exists); an existing file is kept unless --force.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import { generateKiloMeshPlugin, KILO_MESH_PLUGIN_FILE } from './opencode-mesh-plugin.js';
import type { InitOptions, InitResult } from './types.js';

export function writeKiloMeshPlugin(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): void {
  const usesKilo = ['.kilo', '.kilocode'].some((d) => fs.existsSync(path.join(targetDir, d)));
  if (!usesKilo) return;
  const file = path.join(targetDir, KILO_MESH_PLUGIN_FILE);
  if (fs.existsSync(file) && !options.force) {
    result.skipped.push(KILO_MESH_PLUGIN_FILE);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFile(file, generateKiloMeshPlugin());
  result.created.files.push(KILO_MESH_PLUGIN_FILE);
}
