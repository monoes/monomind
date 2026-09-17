/**
 * #265: `monomind autopilot log` printed each entry's time as
 * `new Date(e.ts).toISOString().slice(11, 19)` — a UTC clock time with no zone
 * marker. An operator outside UTC reads that as local and is silently off by
 * their offset, which is the same defect #253 fixed for the org runtime's
 * report/log lines (orgrt/reporting.ts now appends `Z`).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { autopilotCommand } from '../commands/autopilot.js';
import { output } from '../output.js';
import type { CommandContext } from '../types.js';

vi.mock('../autopilot-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../autopilot-state.js')>()),
  // 2026-01-02T03:04:05Z — a moment whose UTC clock time differs from local
  // time in every zone but UTC itself.
  loadLog: () => [{ ts: Date.UTC(2026, 0, 2, 3, 4, 5), event: 'enabled' }],
}));

const logCommand = autopilotCommand.subcommands?.find((c) => c.name === 'log');

/** Run `autopilot log` and collect what it printed. */
async function runLog(): Promise<string[]> {
  const lines: string[] = [];
  vi.spyOn(output, 'writeln').mockImplementation((text = '') => {
    lines.push(text);
  });
  await logCommand?.action?.({ args: [], flags: {} } as unknown as CommandContext);
  return lines;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('autopilot log timestamps (#265)', () => {
  it('marks the time as UTC so it is not read as local', async () => {
    expect(await runLog()).toEqual(['[03:04:05Z] enabled ']);
  });

  it('prints no bare clock time that could pass for local', async () => {
    for (const line of await runLog()) {
      expect(line).not.toMatch(/\[\d{2}:\d{2}:\d{2}\]/);
    }
  });
});
