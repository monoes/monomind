// orgrt/documents/durable-fs.ts
//
// The few durable file operations the document store needs (org sections spec 6.2: temporary file, fsync,
// rename, directory fsync). Synchronous on purpose: a single-threaded caller that never awaits between the
// steps of one commit is serialised by construction.
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

export function fsyncDir(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** mkdir -p, then fsync every directory the call created and the parent that now lists them. */
export function mkdirDurable(dir: string): void {
  const first = mkdirSync(dir, { recursive: true });
  if (!first) return;
  const rest = dir.slice(first.length).split(sep).filter(Boolean);
  const made = [first];
  for (const part of rest) made.push(join(made[made.length - 1], part));
  for (const d of made) fsyncDir(d);
  fsyncDir(dirname(first));
}

/** Write `text` so that readers see all of it or none of it, and a crash after return keeps it. */
export function writeFileDurable(path: string, text: string): void {
  mkdirDurable(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  fsyncDir(dirname(path));
}
