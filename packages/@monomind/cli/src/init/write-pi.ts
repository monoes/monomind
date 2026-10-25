/**
 * Pi mesh extension: `.pi/extensions/monomind-mesh.ts`. An existing file is kept unless --force.
 * Pi loads project extensions from `.pi/extensions/` after the user trusts the project.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from './fs-helpers.js';
import { generatePiMeshExtension, PI_MESH_EXTENSION_FILE } from './pi-generator.js';
import type { InitOptions, InitResult } from './types.js';

export function writePiMeshExtension(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): void {
  const file = path.join(targetDir, PI_MESH_EXTENSION_FILE);
  if (fs.existsSync(file) && !options.force) {
    result.skipped.push(PI_MESH_EXTENSION_FILE);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFile(file, generatePiMeshExtension());
  result.created.files.push(PI_MESH_EXTENSION_FILE);
}
