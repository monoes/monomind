/**
 * `doctor --read-only` and `doctor --offline` (issue #335): a health check a
 * caller can run without it changing anything or touching the network.
 * doc/agent-exec-protocol.md §10.
 *
 * Read-only is the default under `--json` (mono-agent's checks never change
 * anything) unless `--fix`/`--install` asks for writes. It is about files, not
 * the network: the version check still asks the npm registry, through a
 * throwaway npm cache. `--offline` skips every check that needs the network.
 */

import { output } from '../output.js';
import type { CommandOption, CommandResult } from '../types.js';
import type { HealthCheck } from './doctor-env-checks.js';

export interface DoctorMode {
  readOnly: boolean;
  offline: boolean;
}

export type SkipReason = 'read-only' | 'offline';

export const DOCTOR_MODE_OPTIONS: CommandOption[] = [
  {
    name: 'read-only',
    description:
      'Change no file: no fixes, no registry refresh, no update check (default with --json unless --fix/--install)',
    type: 'boolean',
  },
  {
    name: 'offline',
    description: 'Skip the checks that use the network; they are reported as skipped',
    type: 'boolean',
    default: false,
  },
];

export function resolveDoctorMode(flags: Record<string, unknown>): DoctorMode & { error?: string } {
  const json = Boolean(flags.json) || flags.format === 'json';
  const writes = Boolean(flags.fix) || Boolean(flags.install);
  const explicit = flags.readOnly ?? flags['read-only'];
  const mode: DoctorMode = {
    readOnly: typeof explicit === 'boolean' ? explicit : json && !writes,
    offline: Boolean(flags.offline),
  };
  if (explicit === true && writes)
    return { ...mode, error: '--read-only cannot be combined with --fix or --install' };
  if (mode.offline && flags.install)
    return {
      ...mode,
      error: '--offline cannot be combined with --install (it downloads software)',
    };
  return mode;
}

/** `Mode: read-only, offline` for the human header, or '' for a plain run. */
export function modeLabel(mode: DoctorMode): string {
  const on = [mode.readOnly && 'read-only', mode.offline && 'offline'].filter(Boolean);
  return on.length ? `Mode: ${on.join(', ')}` : '';
}

/** A run refused before any check (e.g. `--read-only --fix`). */
export function doctorError(error: string): CommandResult {
  output.writeln(output.error(error));
  return {
    success: false,
    exitCode: 1,
    data: { passed: 0, warnings: 0, failed: 1, results: [], error },
  };
}

/**
 * Checks a mode skips, with the name their result would carry. `probe`
 * entries only apply to `-c <component>`: the full run already uses their
 * config-only variant, which needs neither the network nor any writes.
 */
const SKIPS: Record<string, { name: string; when: SkipReason[]; why: string; probe?: true }> = {
  version: { name: 'Version Freshness', when: ['offline'], why: 'asks the npm registry' },
  freshness: { name: 'Version Freshness', when: ['offline'], why: 'asks the npm registry' },
  'monoes-tools': { name: 'monoes Tools', when: ['offline'], why: 'queries GitHub releases' },
  jev: {
    name: 'Decision Model (Jev)',
    when: ['offline'],
    why: 'probes the decision-model providers over HTTP',
    probe: true,
  },
  decision: {
    name: 'Decision Model (Jev)',
    when: ['offline'],
    why: 'probes the decision-model providers over HTTP',
    probe: true,
  },
  mcp: {
    name: 'MCP Servers',
    when: ['offline', 'read-only'],
    why: 'starts the configured MCP server, which may download it and runs its own startup',
    probe: true,
  },
  kg: {
    name: 'Memory Knowledge Graph',
    when: ['read-only'],
    why: 'counting it opens the memory database, which writes to it',
  },
  pick: {
    name: 'Agent/Skill Picking',
    when: ['read-only'],
    why: 'rebuilds stale agent and skill indexes',
  },
};

/** The result for a check this mode skips, or null when it runs. */
export function skippedCheck(
  component: string,
  mode: DoctorMode,
  single: boolean,
): HealthCheck | null {
  const s = SKIPS[component];
  if (!s || (s.probe && !single)) return null;
  const reason = s.when.find((r) => (r === 'offline' ? mode.offline : mode.readOnly));
  if (!reason) return null;
  return {
    name: s.name,
    status: 'skipped',
    skippedReason: reason,
    message: `Skipped (${reason === 'offline' ? '--offline' : 'read-only'}): ${s.why}`,
  };
}
