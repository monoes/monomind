// packages/@monomind/cli/src/orgrt/scheduler.ts

/** "15m" | "2h" | "45s" | minutes as number | null → interval ms or null */
export function parseSchedule(s: string | number | null | undefined): number | null {
  if (s == null) return null;
  if (typeof s === 'number') return s * 60_000;
  const m = /^(\d+)\s*(s|m|h)$/.exec(s.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
}

/** Fires runFn(name, intervalMs) every intervalMs per org. Real timer loop — no ScheduleWakeup, no prompts. */
export class OrgScheduler {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private running = new Set<string>();
  /** Orgs whose tick arrived mid-run. A dropped tick meant an org that overruns
   *  its interval — a 200m cycle on a 2h schedule — idled until the *next*
   *  boundary, so a run longer than the period produced a sawtooth of work then
   *  dead time. Recorded here instead and fired the moment the run ends.
   *  A Set, so N missed ticks coalesce into one catch-up run, never a backlog. */
  private pending = new Set<string>();

  constructor(private runFn: (name: string, intervalMs: number) => Promise<void>) {}

  /** @param runNow fire one iteration immediately instead of waiting a full
   *  interval. Callers pass true only when the org is actually due (never run,
   *  or last run older than the interval) — `serve` used to register a bare
   *  setInterval, so a freshly-started daemon sat idle for the whole period
   *  before its first tick, and an org on a 2h schedule looked broken for two
   *  hours. Gating on due-ness keeps a daemon restart from re-running
   *  everything at once. */
  add(name: string, intervalMs: number, runNow = false, sinceLastRunMs?: number): void {
    this.remove(name);
    const fire = async (): Promise<void> => {
      if (this.running.has(name)) {
        this.pending.add(name);
        return;
      } // catch up when it ends
      this.running.add(name);
      try {
        await this.runFn(name, intervalMs);
      } catch (err) {
        console.error(`[org-scheduler] ${name}: scheduled run failed:`, err);
      } finally {
        this.running.delete(name);
        // Only chase a missed tick if this org is still scheduled — remove()/stop()
        // during a run must not resurrect it. Deferred through the event loop so
        // back-to-back catch-ups unwind the stack instead of recursing.
        if (this.pending.delete(name) && this.timers.has(name)) {
          const t = setTimeout(() => {
            void fire();
          }, 0);
          (t as { unref?: () => void }).unref?.();
        }
      }
    };
    // Phase the first tick to the org's own clock, not the daemon's. A restart
    // used to reset the period wholesale: an org that ran 24 minutes ago on a
    // 2h schedule then waited a further 2h instead of the 1h36m it was owed,
    // so every restart silently stole up to a full interval. Resume the
    // remainder, then settle into the steady cadence.
    const remaining =
      sinceLastRunMs != null ? Math.max(0, intervalMs - sinceLastRunMs) : intervalMs;
    if (!runNow && remaining < intervalMs) {
      // Deliberately NOT unref'd, matching the setInterval it stands in for.
      // `org serve --cross-process false` starts no HTTP server, so during the
      // lead window the scheduler's timer is the only ref'd handle; unref'ing
      // it let the event loop drain and the daemon exit on startup instead of
      // waiting for the org's turn. (Signal listeners do not hold the loop
      // open — verified, not assumed.)
      const lead = setTimeout(() => {
        this.timers.set(name, setInterval(fire, intervalMs));
        void fire();
      }, remaining);
      this.timers.set(name, lead as unknown as ReturnType<typeof setInterval>);
      return;
    }
    this.timers.set(name, setInterval(fire, intervalMs));
    if (runNow) void fire();
  }

  remove(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
    this.pending.delete(name); // an unscheduled org has no tick to catch up on
  }

  stop(): void {
    for (const name of [...this.timers.keys()]) this.remove(name);
  }
}
