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

  add(name: string, intervalMs: number): void {
    this.remove(name);
    this.timers.set(name, setInterval(async () => {
      if (this.running.has(name)) return; // skip if previous iteration still running
      this.running.add(name);
      try { await this.runFn(name, intervalMs); }
      catch (err) { console.error(`[org-scheduler] ${name}: scheduled run failed:`, err); }
      finally { this.running.delete(name); }
    }, intervalMs));
  }

  remove(name: string): void {
    const t = this.timers.get(name);
    if (t) clearInterval(t);
    this.timers.delete(name);
  }

  stop(): void { for (const name of [...this.timers.keys()]) this.remove(name); }
}
