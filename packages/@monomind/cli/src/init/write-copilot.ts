/**
 * GitHub Copilot CLI mesh hooks: `.github/hooks/monomind-mesh.{json,cjs}`.
 * Written next to the Claude helpers they bridge to (components.helpers), and
 * only for a project that uses Copilot or Hermes: the platform was selected, or
 * the project already has `.github/copilot-instructions.md` or an earlier copy
 * of these hooks. An existing file is kept unless --force.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  COPILOT_HOOKS_FILE,
  COPILOT_MESH_SCRIPT,
  generateCopilotHooksJson,
  generateMeshBridgeScript,
} from './copilot-generator.js';
import { atomicWriteFile } from './fs-helpers.js';
import type { InitOptions, InitResult } from './types.js';

export function writeCopilotMeshHooks(
  targetDir: string,
  options: InitOptions,
  result: InitResult,
): void {
  const selected = options.selectedPlatforms?.some((p) => p === 'copilot' || p === 'hermes');
  const inProject = [
    COPILOT_HOOKS_FILE,
    COPILOT_MESH_SCRIPT,
    '.github/copilot-instructions.md',
  ].some((rel) => fs.existsSync(path.join(targetDir, rel)));
  if (!selected && !inProject) return;
  const files: [string, string][] = [
    [COPILOT_MESH_SCRIPT, generateMeshBridgeScript()],
    [COPILOT_HOOKS_FILE, generateCopilotHooksJson()],
  ];
  for (const [rel, content] of files) {
    const file = path.join(targetDir, rel);
    if (fs.existsSync(file) && !options.force) {
      result.skipped.push(rel);
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    atomicWriteFile(file, content);
    result.created.files.push(rel);
  }
}
