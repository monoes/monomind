/**
 * The CDP port monomind's own Chrome defaults to. Not 9222: mono-agent's
 * extension bridge permanently owns that one and answers only /monoagent
 * routes, so a connect to it never reaches Chrome (#666). 9422 sits outside
 * the 922x/932x neighbourhood mono-agent uses (9222 bridge, 9232 test
 * bridge, 9323 bridge fallback); launching still scans upward if it is busy.
 */
export const DEFAULT_CDP_PORT = 9422;

/**
 * Ports probed by `connect --auto-connect`. 9222 stays a probe so a user's
 * own `--remote-debugging-port=9222` Chrome is still found.
 */
export const CDP_PROBE_PORTS: readonly number[] = [DEFAULT_CDP_PORT, 9222, 9229];

/**
 * The configured CDP port: MONOBROWSE_CDP_PORT, else the two older names
 * (MONOBROWSE_PORT, MONOMIND_CDP_PORT; deprecated aliases), else the default.
 */
export function resolveCdpPort(env: NodeJS.ProcessEnv = process.env): number {
  for (const name of ['MONOBROWSE_CDP_PORT', 'MONOBROWSE_PORT', 'MONOMIND_CDP_PORT']) {
    const port = Number.parseInt(env[name] ?? '', 10);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return DEFAULT_CDP_PORT;
}
