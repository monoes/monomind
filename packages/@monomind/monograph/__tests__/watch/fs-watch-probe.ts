/**
 * Whether this host delivers file-change events (#798). The watcher rides on
 * chokidar, i.e. fs.watch; inside a macOS Seatbelt sandbox (the release gate
 * runs the suite in one) no event arrives, so a test waiting for one can only
 * time out. A child process watches a fresh temp dir and writes a file into
 * it, under a timeout; the suite warns when no event came, so the skip shows.
 */
import { spawnSync } from 'node:child_process';

const PROBE = `
const fs = require('node:fs');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mg-watch-probe-'));
const done = (code) => {
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(code);
};
try {
  const w = fs.watch(dir, () => done(0));
  w.on('error', () => done(1));
  setTimeout(() => fs.writeFileSync(path.join(dir, 'probe.ts'), 'x'), 100);
  setTimeout(() => done(1), 2000);
} catch {
  done(1);
}
`;

export function fileEventsArrive(suite: string): boolean {
  const r = spawnSync(process.execPath, ['-e', PROBE], { stdio: 'ignore', timeout: 5000 });
  if (r.status === 0) return true;
  const why = r.error?.message ?? (r.signal ? `killed by ${r.signal}` : 'no event within 2s');
  console.warn(`${suite}: skipped, fs.watch delivers no file-change events here (${why}, #798)`);
  return false;
}
