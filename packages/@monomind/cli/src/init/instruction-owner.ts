/**
 * Instruction files init fills with its own full managed block. The platform
 * adapter pass writes a short `instructions:<id>` block into the same file, so
 * a Claude project used to get two monomind blocks in CLAUDE.md. Where init's
 * block is there, the adapter's is dropped and the adapter leaves the file
 * alone; where it is not (a CLAUDE.md init kept without --force), the short
 * block is the only one.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { removeManagedMarker } from '../platform-adapters/merge.js';
import { backup } from '../platform-adapters/mutation.js';
import type { PlatformId } from '../platform-adapters/types.js';
import { atomicWriteFile } from './fs-helpers.js';
import { readGeneratedBlock } from './managed-block.js';
import type { InitOptions, InitResult } from './types.js';

/** The init block that stands in for a platform's `instructions:<id>` block. */
export const INIT_INSTRUCTION_BLOCKS: Partial<
  Record<PlatformId, { file: string; marker: string }>
> = {
  claude: { file: 'CLAUDE.md', marker: 'claude-md' },
};

/**
 * The instruction file the adapter pass must leave alone for `platform`, or
 * undefined. A stale adapter block in it is removed first (backed up into
 * `backupDir`), except under --if-missing, which changes no existing file.
 */
export function claimInstructionFile(
  targetDir: string,
  platform: PlatformId,
  options: InitOptions,
  backupDir: string,
  result: InitResult,
): string | undefined {
  const owner = INIT_INSTRUCTION_BLOCKS[platform];
  if (!owner) return undefined;
  const file = path.join(targetDir, owner.file);
  if (!fs.existsSync(file)) return undefined;
  const text = fs.readFileSync(file, 'utf-8');
  if (readGeneratedBlock(text, owner.marker) === null) return undefined;
  const marker = `instructions:${platform}`;
  const without = removeManagedMarker(text, marker).replace(/\n{2,}$/, '\n');
  if (without !== text && !options.ifMissing) {
    backup(file, targetDir, false, backupDir);
    atomicWriteFile(file, without);
    result.updated.push(`${owner.file} (removed the duplicate ${marker} block)`);
  }
  return file;
}
