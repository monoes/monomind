/**
 * rmSync for a test run's temp dirs: a test may leave a directory read-only
 * (chmod 0500 to prove a write is refused), which makes a plain recursive
 * remove fail with EACCES and the run's teardown report an error.
 */
import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function makeWritable(dir: string): void {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) return;
  try {
    chmodSync(dir, 0o700);
    for (const name of readdirSync(dir)) makeWritable(join(dir, name));
  } catch {
    /* gone or not ours: the remove below reports what is left */
  }
}

/**
 * Node retries ENOTEMPTY/EBUSY/EPERM itself with a linear backoff (50 ms, 100 ms, ... 500 ms: about
 * 2.7 s in all). A test run's temp home can still be written to when the file's afterAll runs (a
 * timer or a daemon's last write that outlives the test), and without a retry that shows up as a
 * file-level "ENOTEMPTY: directory not empty, rmdir" failure that has nothing to do with the test.
 */
const REMOVE = { recursive: true, force: true, maxRetries: 10, retryDelay: 50 } as const;

export function removeTree(dir: string): void {
  try {
    rmSync(dir, REMOVE);
  } catch {
    makeWritable(dir);
    rmSync(dir, REMOVE);
  }
}
