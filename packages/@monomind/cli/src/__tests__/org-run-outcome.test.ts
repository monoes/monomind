/**
 * #206: `monomind org run <name>` used to exit 0 unconditionally once the
 * run stopped, whether it completed its goal, was stopped by the idle
 * watchdog, or crashed — scripts and process supervisors (launchd/systemd)
 * driving off the exit code couldn't tell success from failure.
 *
 * `runOutcomeResult` is the extracted decision runAction makes after
 * re-reading runtime.json's final state (mirrors resolvedIdleNudgeCount's
 * precedent for the idle watchdog — a pure decision pulled out of a command
 * handler so it's testable without a real daemon/org).
 */
import { describe, it, expect } from 'vitest';
import { runOutcomeResult } from '../commands/org.js';

describe('runOutcomeResult', () => {
  it('exits 0 on a clean, goal-driven completion (closedBy: org-complete)', () => {
    const result = runOutcomeResult('alpha', { status: 'stopped', closedBy: 'org-complete' });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBeUndefined();
  });

  it('exits 1 with the recorded error on a process-level crash', () => {
    const result = runOutcomeResult('alpha', { status: 'crashed', error: 'FATAL 403 quota error' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('FATAL 403 quota error');
  });

  it('exits 1 with a generic unknown-error message when crashed with no recorded error', () => {
    const result = runOutcomeResult('alpha', { status: 'crashed' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain('unknown error');
  });

  it('exits 1 when the run stopped without org_complete (idle watchdog / boss-restart-exhausted)', () => {
    // status: 'stopped' with no closedBy — exactly what idleStop() and
    // scheduleBossRestart's give-up path leave behind.
    const result = runOutcomeResult('alpha', { status: 'stopped' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.message).toMatch(/not via org_complete/);
  });

  it('exits 1 when runtime.json could not be read at all (empty state)', () => {
    const result = runOutcomeResult('alpha', {});
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it('a status of "running" (e.g. the CLI itself was SIGKILLed, nothing updated runtime.json) is treated as non-clean, not success', () => {
    const result = runOutcomeResult('alpha', { status: 'running' });
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});
