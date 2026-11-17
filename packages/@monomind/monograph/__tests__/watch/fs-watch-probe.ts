/**
 * Whether this host delivers file-change events (#798). The watcher rides on
 * chokidar, i.e. fs.watch; inside a macOS Seatbelt sandbox (the release gate
 * runs the suite in one) FSEvents is unreachable and the watch fails with an
 * EMFILE error event (checked against the profile Claude Code's sandbox
 * builds), so a test waiting for an event can only time out. A child process
 * watches a fresh temp dir and writes a file into it, under a timeout; the
 * suite warns with what the child saw (an error, no event, or no temp dir), so
 * the skip shows and says why.
 */
import { spawnSync } from 'node:child_process';

const PROBE = `
const fs = require('node:fs');
const path = require('node:path');
let dir;
const done = (code, why) => {
  if (why) process.stdout.write(why);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code);
};
try {
  dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mg-watch-probe-'));
} catch (e) {
  done(1, 'cannot create a temp dir: ' + e.message);
}
try {
  const w = fs.watch(dir, () => done(0));
  w.on('error', (e) => done(1, 'fs.watch failed: ' + e.message));
  setTimeout(() => fs.writeFileSync(path.join(dir, 'probe.ts'), 'x'), 100);
  setTimeout(() => done(1, 'no event within 2s'), 2000);
} catch (e) {
  done(1, 'fs.watch failed: ' + e.message);
}
`;

export function fileEventsArrive(suite: string): boolean {
  const r = spawnSync(process.execPath, ['-e', PROBE], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 5000,
  });
  if (r.status === 0) return true;
  const why =
    r.error?.message ?? (r.signal ? `killed by ${r.signal}` : r.stdout.trim() || `exit ${r.status}`);
  console.warn(`${suite}: skipped, fs.watch delivers no file-change events here (${why}, #798)`);
  return false;
}
