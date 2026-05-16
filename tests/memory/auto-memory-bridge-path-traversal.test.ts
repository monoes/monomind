import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as os from 'os';

// Import directly from source (vitest resolves .ts)
import { resolveAutoMemoryDir } from '../../packages/@monomind/memory/src/auto-memory-bridge.js';

describe('resolveAutoMemoryDir — path traversal rejection', () => {
  it('resolves a normal absolute path into HOME/.claude/projects/.../memory', () => {
    const result = resolveAutoMemoryDir('/workspaces/myproject');
    const expectedBase = path.resolve(os.homedir(), '.claude', 'projects');
    expect(result.startsWith(expectedBase + path.sep)).toBe(true);
    expect(result.endsWith(path.sep + 'memory')).toBe(true);
  });

  it('throws when the derived projectKey contains a ".." segment', () => {
    // A path like /foo/../../etc/passwd would after split-join produce
    // a projectKey with ".." segments, triggering the guard.
    expect(() => {
      // Directly test by simulating a crafted basePath.
      // We call with a path whose normalization contains ".."
      // The function calls findGitRoot first; mock by testing with CWD
      // that would not have a git root higher than the path itself.
      // Best approach: test via a workaround — we pass a path that ends up
      // containing ".." after normalization.
      // Since findGitRoot returns null for non-git dirs, workingDir is used directly.
      resolveAutoMemoryDir('/legitimate/path/../../../etc');
    }).toThrow(/traversal|Invalid project path/i);
  });

  it('throws when a "." segment appears in the derived projectKey', () => {
    expect(() => {
      resolveAutoMemoryDir('/some/./path');
    }).toThrow(/traversal|Invalid project path/i);
  });

  it('does not throw for paths with no traversal components', () => {
    // Standard paths like /home/user/projects/myapp should pass cleanly
    expect(() => {
      resolveAutoMemoryDir(os.tmpdir() + '/safe-test-project-123');
    }).not.toThrow();
  });
});
