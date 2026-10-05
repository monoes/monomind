import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync(
  new URL('../../.github/workflows/claude-sdk-refresh.yml', import.meta.url),
  'utf8',
);
/** The text of one top-level job. */
const job = (name) => {
  const start = text.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const rest = text.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z-]+:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
};

describe('the Claude SDK refresh workflow', () => {
  it('pins every third-party action to a commit', () => {
    for (const line of text.split('\n').filter((l) => /uses:/.test(l)))
      expect(line, line).toMatch(/uses: [\w./-]+@[0-9a-f]{40}\b/);
  });
  it('holds no write permission at the top level or in the job that runs the downloaded binary', () => {
    expect(text.split('\njobs:')[0]).not.toMatch(/: write/);
    const compute = job('compute');
    expect(compute).toMatch(/contents: read/);
    expect(compute).not.toMatch(/: write/);
    expect(compute).toMatch(/persist-credentials: false/);
    expect(compute).toMatch(/claude-sdk-maintenance\.mjs --update/);
  });
  it('opens the pull request from a separate job that runs no command at all', () => {
    const open = job('open-pr');
    expect(open).toMatch(/needs: compute/);
    expect(open).toMatch(/contents: write/);
    expect(open).toMatch(/pull-requests: write/);
    expect(open).toMatch(/persist-credentials: false/);
    expect(open).toMatch(/peter-evans\/create-pull-request@/);
    expect(open).not.toMatch(/\n\s+run:/);
  });
});
