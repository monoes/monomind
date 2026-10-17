// `codex` and `agy` on a mise machine are launcher scripts: `mise use -g <tool>` (writes
// ~/.config/mise/config.toml) then `exec mise x <tool> -- <exe>`. A role sandboxed with a
// read-only HOME dies before the model starts ("mise ERROR Read-only file system"), and
// `agent test` misses it because it runs outside the sandbox (reputation-panel, 2026-10-17).
// The runners run the real binary the launcher would have exec'd.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { realBinary } from '../../src/orgrt/launcher-binary.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'launcher-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'real'));
});

const exe = (path: string, body: string): string => {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
};
const launcher = (tool: string, name = tool): string =>
  `#!/bin/bash\nexport MISE_MINIMUM_RELEASE_AGE=0\nmise use -g --quiet "${tool}" || exit 1\nexec mise x "${tool}" -- "${name}" "$@"\n`;
const fakeMise = (answer: string): string =>
  exe(join(dir, 'bin', 'mise'), `#!/bin/sh\n[ "$1" = which ] && { echo "${answer}"; exit 0; }\nexit 1\n`);
const env = (): NodeJS.ProcessEnv => ({ PATH: join(dir, 'bin') });

describe('realBinary', () => {
  it('returns the real binary behind a mise launcher found on PATH', () => {
    exe(join(dir, 'bin', 'codex'), launcher('codex'));
    const real = exe(join(dir, 'real', 'codex'), '#!/bin/sh\nexit 0\n');
    fakeMise(real);
    expect(realBinary('codex', env())).toBe(real);
  });

  it('resolves a launcher given by explicit path, using the tool name the launcher names', () => {
    const l = exe(join(dir, 'bin', 'agy'), launcher('antigravity-cli', 'agy'));
    const real = exe(join(dir, 'real', 'agy'), '#!/bin/sh\nexit 0\n');
    fakeMise(real);
    expect(realBinary(l, env())).toBe(real);
  });

  it('leaves a binary that is not a launcher alone', () => {
    exe(join(dir, 'bin', 'codex'), '#!/bin/sh\necho hi\n');
    fakeMise(join(dir, 'real', 'never'));
    expect(realBinary('codex', env())).toBe('codex');
  });

  it('keeps the launcher when mise is missing, fails, or names a file that is not executable', () => {
    exe(join(dir, 'bin', 'codex'), launcher('codex'));
    expect(realBinary('codex', env())).toBe('codex'); // no mise on PATH
    fakeMise(join(dir, 'real', 'absent'));
    expect(realBinary('codex', env())).toBe('codex'); // mise names a missing file
    exe(join(dir, 'bin', 'mise'), '#!/bin/sh\nexit 1\n');
    expect(realBinary('codex', env())).toBe('codex'); // mise which fails
  });

  it('returns the name unchanged when it is not on PATH at all', () => {
    expect(realBinary('codex', env())).toBe('codex');
  });
});
