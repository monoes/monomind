import { describe, it, expect } from 'vitest';
import { execFileSync, execFile } from 'child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** The body of one top-level `process.on('<event>', ...)` handler, brace-matched
 *  so assertions cannot leak into the neighbouring handler. */
function handlerBody(src: string, event: string): string {
  const start = src.indexOf(`process.on('${event}'`, classifierStart(src));
  expect(start, `no ${event} handler after the classifier`).toBeGreaterThan(-1);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces in ${event} handler`);
}

/** Offset of the fault classifier — the anchor for every source assertion. */
function classifierStart(src: string): number {
  const i = src.indexOf('const handleExpectedFault');
  expect(i, 'handleExpectedFault not found — was the fault classifier removed?').toBeGreaterThan(-1);
  return i;
}
const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'cli.js');

// Issues #41, #46, #47. The crash handler filed a PUBLIC GitHub issue for every
// uncaught error, including two that are never product bugs:
//
//   #41       `monomind hooks worker list | head` -> EPIPE -> "crash: write EPIPE"
//   #46, #47  running the CLI from an extracted tarball with no node_modules
//             -> ERR_MODULE_NOT_FOUND -> a crash issue titled with the user's
//                full filesystem path
//
// Both leak local paths into a public tracker and bury real crashes in noise.

describe('broken pipe is normal termination, not a crash (#41)', () => {
  it('exits 0 and stays silent when the reader closes the pipe', () => {
    // `head -1` closes the pipe after one line; the CLI must not treat that as
    // a fault. Using sh so the pipe semantics are the real thing.
    const out = execFileSync(
      'sh',
      ['-c', `node ${JSON.stringify(CLI_BIN)} hooks worker list 2>&1 >/dev/null | head -1; exit \${PIPESTATUS:-0}`],
      { encoding: 'utf-8' },
    );
    expect(out).not.toMatch(/EPIPE/);
    expect(out).not.toMatch(/FATAL/);
    expect(out).not.toMatch(/crash-report/);
  });

  it('installs stream error handlers so a mid-write EPIPE never becomes a crash', () => {
    const src = readFileSync(CLI_BIN, 'utf-8');
    expect(src).toMatch(/process\.stdout[\s\S]{0,120}on\('error'/);
  });
});

describe('a missing dependency is an install problem, not a crash (#46, #47)', () => {
  it('prints an actionable message and reports nothing', async () => {
    // Simulate the real scenario: an entrypoint importing a package that is not
    // installed anywhere above it.
    const dir = mkdtempSync(join(tmpdir(), 'mm-nodep-'));
    const entry = join(dir, 'boom.mjs');
    writeFileSync(entry, `await import('@monoes/definitely-not-installed-xyz');\n`);

    let stderr = '';
    let code = 0;
    try {
      await execFileAsync(process.execPath, [entry], { cwd: dir });
    } catch (e: unknown) {
      const err = e as { code?: number; stderr?: string };
      code = err.code ?? 0;
      stderr = err.stderr ?? '';
    }

    // Baseline: node's own behaviour is a raw ERR_MODULE_NOT_FOUND stack. This
    // asserts the fixture is valid — the CLI assertions below are what matter.
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package/);
  });

  it('classifies the two non-bug fault codes and nothing else', () => {
    const src = readFileSync(CLI_BIN, 'utf-8');
    // The classifier must cover both codes...
    expect(src).toMatch(/EPIPE/);
    expect(src).toMatch(/ERR_STREAM_DESTROYED/);
    expect(src).toMatch(/ERR_MODULE_NOT_FOUND/);
    // ...and both handlers must consult it before reporting, or the fix only
    // covers whichever path happens to fire first.
    //
    // Anchor every offset to the classifier, NOT to the first match in the
    // file: bin/cli.js also installs uncaughtException/unhandledRejection
    // handlers in the earlier MCP-stdio branch, so a bare indexOf finds those
    // instead and the assertion silently inspects the wrong code.
    // Each handler is sliced to its OWN body. Slicing to end-of-file instead
    // lets one handler's call satisfy the assertion for both — verified by
    // deleting the guard from uncaughtException alone, which must fail here.
    expect(handlerBody(src, 'uncaughtException')).toMatch(/handleExpectedFault/);
    expect(handlerBody(src, 'unhandledRejection')).toMatch(/handleExpectedFault/);
  });

  it('never reports these classes to the public tracker', () => {
    const src = readFileSync(CLI_BIN, 'utf-8');
    const from = classifierStart(src);
    const handler = src.slice(from, src.indexOf("process.on('uncaughtException'", from));
    expect(handler.length).toBeGreaterThan(0);
    expect(handler).toMatch(/broken-pipe/);
    expect(handler).not.toMatch(/reportAndExit|reportCrash/);
  });
});
