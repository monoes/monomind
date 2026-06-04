/**
 * Native binding loader for @monoes/attention.
 * Loads the platform-specific .node binary (local file first, then the
 * published platform package). Falls back with a clear error if unavailable.
 */
const { platform, arch } = process;

function tryRequire(id) {
  try { return require(id); } catch { return null; }
}

let nativeBinding = null;

if (platform === 'darwin' && arch === 'arm64') {
  nativeBinding = tryRequire('./index.darwin-arm64.node') || tryRequire('@monoes/attention-darwin-arm64');
} else if (platform === 'darwin' && arch === 'x64') {
  nativeBinding = tryRequire('./index.darwin-x64.node') || tryRequire('@monoes/attention-darwin-x64');
} else if (platform === 'linux' && arch === 'x64') {
  nativeBinding = tryRequire('./index.linux-x64-gnu.node') || tryRequire('@monoes/attention-linux-x64-gnu');
} else if (platform === 'linux' && arch === 'arm64') {
  nativeBinding = tryRequire('./index.linux-arm64-gnu.node') || tryRequire('@monoes/attention-linux-arm64-gnu');
} else if (platform === 'win32' && arch === 'x64') {
  nativeBinding = tryRequire('./index.win32-x64-msvc.node') || tryRequire('@monoes/attention-win32-x64-msvc');
}

if (!nativeBinding) {
  throw new Error(
    `@monoes/attention: no native binary for ${platform}-${arch}. ` +
    `Available: darwin-arm64, linux-x64-gnu, linux-arm64-gnu, win32-x64-msvc.`
  );
}

module.exports = nativeBinding;
