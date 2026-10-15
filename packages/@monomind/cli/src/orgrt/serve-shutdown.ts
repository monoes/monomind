// packages/@monomind/cli/src/orgrt/serve-shutdown.ts
// Signal handling for `org serve`: SIGTERM/SIGINT start a graceful stop, a second
// signal or an expired hard-exit timer forces the exit, SIGHUP exits at once.

export interface ServeShutdownDeps {
  proc: { on(sig: NodeJS.Signals, handler: () => void): unknown; exit(code?: number): unknown };
  daemon: { persistCrashStateAll(error?: string): void; clearHeartbeat(): void };
  announce(reason: string): void;
  /** Starts the graceful stop (serveAction's wait resolves and runs `daemon.stopAll()`). */
  onGraceful(): void;
  /** Longest the graceful stop may take before the process is force-exited. */
  hardExitMs: number;
}

export function installServeShutdown(deps: ServeShutdownDeps): { finish(): void } {
  const { proc, daemon, announce, onGraceful, hardExitMs } = deps;
  let graceful = false;
  let hardTimer: ReturnType<typeof setTimeout> | undefined;

  // Orgs whose stop has not finished are still in `daemon.orgs`, so only those
  // are marked crashed; orgs that already stopped keep their 'stopped' state.
  const forceExit = (): void => {
    if (hardTimer) clearTimeout(hardTimer);
    try {
      daemon.persistCrashStateAll();
      daemon.clearHeartbeat();
    } catch {
      /* best effort */
    }
    proc.exit(1);
  };

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    proc.on(sig, () => {
      if (graceful) return forceExit();
      graceful = true;
      announce(`received ${sig}`);
      hardTimer = setTimeout(forceExit, hardExitMs);
      hardTimer.unref?.();
      onGraceful();
    });
  }
  proc.on('SIGHUP', () => {
    announce('received SIGHUP');
    forceExit();
  });

  // A daemon holds ref'd timers, so it will not drain on its own; once the
  // graceful stop has finished an explicit exit is required.
  return {
    finish() {
      if (hardTimer) clearTimeout(hardTimer);
      proc.exit(0);
    },
  };
}
