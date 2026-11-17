/**
 * Whether `ps` can read the process table here (#798). The process-group code
 * (orgrt/process-tree.ts, process-tree-marker.ts) finds a run's jobs with
 * `ps -axo`; inside a macOS Seatbelt sandbox (the release gate runs the suite
 * in one) `ps` is denied, so a test that waits for a job to show up can only
 * time out. Runs the same `ps -axo` for this process's own pid, under a
 * timeout, and warns when it fails so the skip shows in the run output.
 */
import { spawnSync } from 'node:child_process';

export function psReadsProcessTable(suite: string): boolean {
  const r = spawnSync('ps', ['-axo', 'pid='], { encoding: 'utf8', timeout: 5000 });
  if (r.status === 0 && r.stdout.split('\n').some((l) => l.trim() === String(process.pid)))
    return true;
  const why =
    r.error?.message ??
    (r.signal ? `killed by ${r.signal}` : r.stderr?.trim() || `exit ${r.status}`);
  console.warn(`${suite}: skipped, \`ps -axo\` cannot read the process table here (${why}, #798)`);
  return false;
}
