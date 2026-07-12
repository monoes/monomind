/**
 * Atomic file write helper — write to a unique tmp path, then rename into
 * place. Prevents truncated/corrupted files on crash mid-write, since
 * rename() is atomic on POSIX and NTFS while a direct writeFileSync() is not.
 *
 * Mirrors the tmp+rename pattern used across @monomind/cli (see
 * packages/@monomind/cli/src/utils/json-file.ts), reimplemented here since
 * @monomind/memory cannot depend on @monomind/cli (cli depends on memory,
 * not the reverse) and this needs to accept raw Buffer/string data, not
 * just JSON.
 */

import { writeFileSync, renameSync } from 'node:fs';

/**
 * Write `data` to `filePath` atomically: write to `${filePath}.${pid}.${ts}.tmp`
 * first, then rename over the destination.
 */
export function writeFileAtomicSync(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
  encoding?: BufferEncoding,
): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  if (typeof data === 'string' && encoding) {
    writeFileSync(tmpPath, data, encoding);
  } else {
    writeFileSync(tmpPath, data as any);
  }
  renameSync(tmpPath, filePath);
}
