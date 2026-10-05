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

export function removeTree(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    makeWritable(dir);
    rmSync(dir, { recursive: true, force: true });
  }
}
