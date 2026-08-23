/**
 * ORG-4 regression: `org test-loop --scenario <file>`'s declarative scenario
 * mode used to hardcode every 'tool' and 'expect' check to `true`, so a
 * scenario always reported 100% passed regardless of what actually happened
 * — pass-always theater. This verifies:
 *  - a 'tool' check now runs the REAL PolicyEngine (a denyTools rule
 *    actually denies, and that's what makes the check pass/fail — not a stub).
 *  - an 'expect' check is evaluated against events REALLY emitted on the
 *    scenario's org bus, so a deliberately-wrong expectation now correctly
 *    FAILS instead of being hardcoded to pass.
 *  - the report is labeled "structural dry-run".
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runTestLoop } from '../orgrt/test-loop.js';

describe('org test-loop --scenario: real (not hardcoded) check evaluation', () => {
  let tmp = '';
  afterEach(() => {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function writeScenario(script: unknown[]) {
    const scenariosDir = join(tmp, '.monomind', 'scenarios');
    mkdirSync(scenariosDir, { recursive: true });
    writeFileSync(
      join(scenariosDir, 'demo.json'),
      JSON.stringify({
        name: 'demo',
        orgs: [
          {
            name: 'alpha',
            goal: 'test',
            roles: [
              { id: 'boss', title: 'Boss', type: 'boss', reports_to: null },
              {
                id: 'coder',
                title: 'Coder',
                type: 'specialist',
                reports_to: 'boss',
                policy: { denyTools: ['Bash'] },
              },
            ],
          },
        ],
        script,
      }),
    );
  }

  it('a denyTools rule really denies the tool call (real policy path, not a stub)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'test-loop-scenario-'));
    writeScenario([
      {
        step: 1,
        from: 'coder',
        action: 'tool',
        tool: 'Bash',
        input: { command: 'echo hi' },
        expect: 'deny',
      },
    ]);

    const report = await runTestLoop(tmp, 1, 'demo.json');
    expect(report.summary).toContain('structural dry-run');
    expect(report.failed).toBe(0); // denyTools really denied Bash, matching the expected 'deny'
  });

  it('a tool call NOT covered by denyTools is really allowed', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'test-loop-scenario-'));
    writeScenario([
      {
        step: 1,
        from: 'coder',
        action: 'tool',
        tool: 'Read',
        input: { file_path: 'out/report.md' },
      },
    ]);

    const report = await runTestLoop(tmp, 1, 'demo.json');
    expect(report.failed).toBe(0);
  });

  it('a deliberately-failing expectation now correctly reports failure, not a hardcoded pass', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'test-loop-scenario-'));
    writeScenario([
      {
        step: 1,
        from: 'coder',
        action: 'tool',
        tool: 'Bash',
        input: { command: 'echo hi' },
        expect: 'deny',
      },
      // Deliberately wrong: Bash was DENIED above, so no 'tool' event with
      // decision=allow for tool=Bash was ever emitted. A hardcoded-true
      // implementation would report this as passed; the real one must not.
      { step: 2, from: 'coder', action: 'expect', expect: 'tool:tool=Bash,decision=allow' },
    ]);

    const report = await runTestLoop(tmp, 1, 'demo.json');
    expect(report.failed).toBeGreaterThan(0);
    expect(report.summary).toContain('structural dry-run');
  });

  it('a correct expectation against a really-emitted event passes', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'test-loop-scenario-'));
    writeScenario([
      {
        step: 1,
        from: 'coder',
        action: 'tool',
        tool: 'Bash',
        input: { command: 'echo hi' },
        expect: 'deny',
      },
      { step: 2, from: 'coder', action: 'expect', expect: 'tool:tool=Bash,decision=deny' },
    ]);

    const report = await runTestLoop(tmp, 1, 'demo.json');
    expect(report.failed).toBe(0);
  });
});
