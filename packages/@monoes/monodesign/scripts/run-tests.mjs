#!/usr/bin/env node
/**
 * Run the node:test suite and FAIL if it ran nothing.
 *
 * `node --test <glob>` exits 0 when the glob matches no files. On Windows that
 * is not hypothetical: npm runs scripts through cmd.exe, which does not treat
 * single quotes as quoting, so `--test 'tests/*.test.*'` reached node with the
 * quotes still attached, matched nothing, and reported:
 *
 *     # tests 0
 *     # pass 0
 *     # fail 0
 *     exit 0
 *
 * A green suite that executed nothing is worse than a red one — it reads as
 * coverage while providing none, and it is exactly what let monodesign look
 * like it passed on Windows during the CI probe.
 *
 * The quoting is fixed in package.json (double quotes survive both cmd.exe and
 * POSIX shells). This wrapper is the guard that stops it silently regressing,
 * on any platform and for any reason — a renamed directory, a changed layout,
 * a bad glob.
 */
import { spawn } from 'node:child_process';

const PATTERNS = ['tests/*.test.*', 'tests/lib/*.test.*'];

// Callers pass through extra node:test flags, e.g. --test-skip-pattern.
const passthrough = process.argv.slice(2);

const child = spawn(
  process.execPath,
  ['--experimental-strip-types', '--test', ...passthrough, ...PATTERNS],
  { stdio: ['inherit', 'pipe', 'inherit'] },
);

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  process.stdout.write(chunk);
});

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`\nTest runner terminated by signal ${signal}`);
    process.exit(1);
  }

  // TAP summary line: "# tests 1027". Absent means the runner never got far
  // enough to summarise, which is itself a failure.
  const match = /^# tests (\d+)$/m.exec(stdout);
  if (!match) {
    console.error(
      '\nCould not find a "# tests N" summary in the runner output — ' +
      'the suite did not complete. Treating as failure.',
    );
    process.exit(1);
  }

  const total = Number(match[1]);
  if (total === 0) {
    console.error(
      `\nThe test runner executed 0 tests and would have exited ${code}.\n` +
      `Patterns: ${PATTERNS.join(', ')} (resolved from ${process.cwd()})\n` +
      'A suite that runs nothing must not report success. Check that the ' +
      'patterns still match — on Windows, single-quoted globs reach node ' +
      'with the quotes attached and match nothing.',
    );
    process.exit(1);
  }

  process.exit(code ?? 1);
});
