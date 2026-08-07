/**
 * Cross-platform npm executable resolution.
 *
 * On Windows, `npm` is a `.cmd` shim and Node >= 18.20.2 refuses to
 * execFile/spawn `.cmd` files without `shell: true` (throws EINVAL).
 * We intentionally avoid `shell: true` everywhere (injection risk), so the
 * fix is to invoke `npm.cmd` directly on win32 (GitHub issue #84).
 */
export function npmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}
