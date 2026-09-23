// packages/@monomind/cli/src/orgrt/cumulative-meter.ts

/** Turns a runner's cumulative-per-session counters (the Claude SDK's
 *  `total_cost_usd` and `modelUsage`) into per-result deltas.
 *
 *  The running total lives in the CLI PROCESS, and a resumed session runs in a
 *  new one. Claude Code restores the previous total into it only when the
 *  resumed session was the last to exit in that project directory, so in an
 *  org (several roles, one cwd) a resume usually starts again from zero.
 *  Deltas keyed by session id alone turned the first result after such a
 *  resume into max(0, small - previous) = 0 (2.16.0 release run: 14.6M tokens
 *  billed at ~$0, USD caps tripping late).
 *
 *  So values are compared within a process, and the first result of a new
 *  process is compared with what the previous process last reported for the
 *  same session: every field at least that high means the total was carried
 *  over (count the increase); anything lower means it restarted (count it all).
 *  Within one process a dip is a provider-side correction and floors at 0. */
export class CumulativeMeter<T extends { [K in keyof T]: number }> {
  private carried = new Map<string, T>();
  private live = new Map<string, T>();

  /** Call when a new runner process starts reporting. */
  newProcess(): void {
    for (const [sid, v] of this.live) this.carried.set(sid, v);
    this.live.clear();
  }

  delta(sid: string, now: T): T {
    const prev = this.live.get(sid);
    this.live.set(sid, now);
    if (prev) return diff(now, prev);
    const carried = this.carried.get(sid);
    if (!carried) return now;
    const keys = Object.keys(now) as (keyof T)[];
    return keys.every((k) => now[k] >= carried[k]) ? diff(now, carried) : now;
  }
}

function diff<T extends { [K in keyof T]: number }>(now: T, prev: T): T {
  const out = { ...now };
  for (const k of Object.keys(now) as (keyof T)[]) {
    out[k] = Math.max(0, now[k] - prev[k]) as T[keyof T];
  }
  return out;
}
