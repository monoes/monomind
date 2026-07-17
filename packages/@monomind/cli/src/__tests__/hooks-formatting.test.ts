import { describe, it, expect } from 'vitest';
import { formatIntelligenceStatus } from '../commands/hooks-formatting.js';
import { output } from '../output.js';

describe('formatIntelligenceStatus', () => {
  it('colors "active" and "ready" as success (green)', () => {
    expect(formatIntelligenceStatus('active')).toBe(output.success('active'));
    expect(formatIntelligenceStatus('ready')).toBe(output.success('ready'));
  });

  it('colors "training" as highlight (cyan/bold)', () => {
    expect(formatIntelligenceStatus('training')).toBe(output.highlight('training'));
  });

  it('colors "idle" as dim', () => {
    expect(formatIntelligenceStatus('idle')).toBe(output.dim('idle'));
  });

  it('colors "disabled" and "error" as error (red)', () => {
    expect(formatIntelligenceStatus('disabled')).toBe(output.error('disabled'));
    expect(formatIntelligenceStatus('error')).toBe(output.error('error'));
  });

  it('returns unknown statuses verbatim, uncolored (default branch)', () => {
    expect(formatIntelligenceStatus('unknown-status')).toBe('unknown-status');
    expect(formatIntelligenceStatus('paused')).toBe('paused');
  });

  it('handles the empty string as an unmatched default value', () => {
    expect(formatIntelligenceStatus('')).toBe('');
  });

  it('handles a very long string as an unmatched default value', () => {
    const long = 'x'.repeat(10_000);
    expect(formatIntelligenceStatus(long)).toBe(long);
  });

  it('handles strings with special/unicode characters as an unmatched default value', () => {
    const special = '!@#$%^&*()\n\t💥<script>alert(1)</script>';
    expect(formatIntelligenceStatus(special)).toBe(special);
  });

  it('is case-sensitive — "Active" does not match the "active" branch', () => {
    // The switch uses exact string equality, so a differently-cased status
    // falls through to the default (verbatim) branch rather than being
    // treated as a synonym of "active" — it is returned completely unmodified,
    // not passed through output.success() at all.
    expect(formatIntelligenceStatus('Active')).toBe('Active');
  });
});
