import { describe, expect, it } from 'vitest';
import { generateCiTemplate } from '../../src/ci-template.js';

/**
 * i-090 revision: `monograph ci` writes this template into a USER's own repo
 * to run `@monoes/monograph` in CI. It is not the same exclusion as the
 * `.claude/**`/`.kimi-code/**` sample-code trees (which describe the *user's*
 * project and make no claim about monomind) — this template pins the Node
 * version that OUR OWN published package (now `engines.node: ">=22.12.0"`)
 * is executed on. A generated workflow pinned to Node 20 installs and runs
 * `npx @monoes/monograph@...` on a runtime its own manifest rejects.
 */
describe('generateCiTemplate', () => {
  it('the GitHub template pins a Node version that can actually run @monoes/monograph', () => {
    const template = generateCiTemplate({ provider: 'github' });
    expect(template.content).not.toMatch(/node-version:\s*'20'/);
    expect(template.content).toMatch(/node-version:\s*'22'/);
  });
});
