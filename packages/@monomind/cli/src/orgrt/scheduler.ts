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

  constructor(private runFn: (name: string, intervalMs: number) => Promise<void>) {}

  /** @param runNow fire one iteration immediately instead of waiting a full
   *  interval. Callers pass true only when the org is actually due (never run,
   *  or last run older than the interval) — `serve` used to register a bare
   *  setInterval, so a freshly-started daemon sat idle for the whole period
   *  before its first tick, and an org on a 2h schedule looked broken for two
   *  hours. Gating on due-ness keeps a daemon restart from re-running
   *  everything at once. */
  add(name: string, intervalMs: number, runNow = false): void {
    this.remove(name);
    const fire = async (): Promise<void> => {
      if (this.running.has(name)) return; // skip if previous iteration still running
      this.running.add(name);
      try { await this.runFn(name, intervalMs); }
      catch (err) { console.error(`[org-scheduler] ${name}: scheduled run failed:`, err); }
      finally { this.running.delete(name); }
    };
    this.timers.set(name, setInterval(fire, intervalMs));
    if (runNow) void fire();
  }

  remove(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
  }

  stop(): void { for (const name of [...this.timers.keys()]) this.remove(name); }
}
