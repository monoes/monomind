// Trigger system for monoplaybook — schedule and webhook triggers.
// Schedule: full 5-field cron syntax (min hour dom month dow).
// Webhook: HTTP endpoint defined in server.ts; TriggerConfig carries the path/secret metadata.

export interface TriggerConfig {
  type: 'schedule' | 'webhook';
  playbookId: string;
  // schedule
  cron?: string;   // e.g. "*/5 * * * *", "0 9 * * 1-5", "30 8,20 * * *"
  // webhook
  path?: string;   // e.g. "/webhooks/my-playbook"
  secret?: string; // HMAC-SHA256 secret for X-Webhook-Signature header verification
}

// ── Cron parser ──────────────────────────────────────────────────────────────

interface CronFields {
  minutes: Set<number>;   // 0–59
  hours: Set<number>;     // 0–23
  days: Set<number>;      // 1–31
  months: Set<number>;    // 1–12
  weekdays: Set<number>;  // 0–6  (0 = Sunday)
  domStar: boolean;       // true when dom field is pure *
  dowStar: boolean;       // true when dow field is pure *
}

/** Parse a single cron field value into the set of matching integers. */
function parseField(field: string, min: number, max: number): Set<number> {
  const result = new Set<number>();

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    // Step syntax: base/step  (e.g. */5, 1-10/2, 0/15)
    const stepIdx = part.indexOf('/');
    if (stepIdx !== -1) {
      const base = part.slice(0, stepIdx);
      const step = parseInt(part.slice(stepIdx + 1), 10);
      if (isNaN(step) || step < 1) throw new Error(`Invalid step in "${part}"`);
      let start = min;
      let end = max;
      if (base !== '*') {
        const dashIdx = base.indexOf('-');
        if (dashIdx !== -1) {
          start = parseInt(base.slice(0, dashIdx), 10);
          end = parseInt(base.slice(dashIdx + 1), 10);
        } else {
          start = parseInt(base, 10);
          end = max;
        }
      }
      for (let i = start; i <= end; i += step) result.add(i);
      continue;
    }

    // Range: N-M
    const dashIdx = part.indexOf('-');
    if (dashIdx !== -1) {
      const start = parseInt(part.slice(0, dashIdx), 10);
      const end = parseInt(part.slice(dashIdx + 1), 10);
      for (let i = start; i <= end; i++) result.add(i);
      continue;
    }

    // Single number
    const n = parseInt(part, 10);
    if (isNaN(n)) throw new Error(`Invalid cron field value "${part}"`);
    result.add(n);
  }

  return result;
}

/** Parse a standard 5-field cron expression. Returns null on failure. */
function parseCron(expr: string): CronFields | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  try {
    const [rawMin, rawHour, rawDom, rawMonth, rawDow] = parts;
    return {
      minutes:  parseField(rawMin,   0,  59),
      hours:    parseField(rawHour,  0,  23),
      days:     parseField(rawDom,   1,  31),
      months:   parseField(rawMonth, 1,  12),
      weekdays: parseField(rawDow,   0,   6),
      domStar: rawDom === '*',
      dowStar: rawDow === '*',
    };
  } catch {
    return null;
  }
}

/**
 * Compute the next Date (> `from`) at which the cron expression fires.
 * Follows POSIX semantics: if both dom and dow are specified (non-*),
 * the job runs when EITHER matches.
 */
function nextFireTime(fields: CronFields, from: Date): Date {
  // Advance to the start of the next minute
  const next = new Date(from.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(next.getMinutes() + 1);

  const limit = new Date(from.getTime() + 366 * 24 * 60 * 60 * 1000);

  while (next < limit) {
    // Month check (getMonth() is 0-based)
    if (!fields.months.has(next.getMonth() + 1)) {
      next.setMonth(next.getMonth() + 1, 1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    // Day check: POSIX OR rule when both dom and dow are non-wildcard
    const domOk = fields.days.has(next.getDate());
    const dowOk = fields.weekdays.has(next.getDay());
    const dayOk = (fields.domStar && fields.dowStar)
      ? domOk && dowOk
      : (!fields.domStar && !fields.dowStar)
        ? domOk || dowOk   // both restricted → OR
        : fields.domStar
          ? dowOk
          : domOk;

    if (!dayOk) {
      next.setDate(next.getDate() + 1);
      next.setHours(0, 0, 0, 0);
      continue;
    }

    // Hour check
    if (!fields.hours.has(next.getHours())) {
      next.setHours(next.getHours() + 1, 0, 0, 0);
      continue;
    }

    // Minute check
    if (!fields.minutes.has(next.getMinutes())) {
      next.setMinutes(next.getMinutes() + 1, 0, 0);
      continue;
    }

    return new Date(next);
  }

  throw new Error(`No fire time found within 1 year for cron "${JSON.stringify(fields)}"`);
}

// ── TriggerManager ───────────────────────────────────────────────────────────

export class TriggerManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Activate a trigger.
   * - schedule: schedules the next firing time via recursive setTimeout.
   *   Fires at exact cron-computed wall-clock times; auto-reschedules.
   * - webhook: no-op here — HTTP routing is handled by the dashboard server.
   */
  activate(config: TriggerConfig, onFire: () => void): void {
    if (config.type === 'webhook') return;

    if (config.type === 'schedule') {
      if (!config.cron) {
        throw new Error(
          `TriggerManager: schedule trigger for "${config.playbookId}" requires a cron expression`,
        );
      }

      const fields = parseCron(config.cron);
      if (!fields) {
        throw new Error(
          `TriggerManager: invalid cron expression "${config.cron}" for playbook "${config.playbookId}". ` +
          'Use standard 5-field syntax: "min hour dom month dow". ' +
          'Each field supports: *, N, N-M, */N, N-M/N, comma lists.',
        );
      }

      this.deactivate(config.playbookId);

      const schedule = (): void => {
        let next: Date;
        try {
          next = nextFireTime(fields, new Date());
        } catch {
          return; // no next fire time (should not happen with normal cron)
        }
        const delay = Math.max(0, next.getTime() - Date.now());
        const handle = setTimeout(() => {
          if (!this.timers.has(config.playbookId)) return; // was deactivated
          try { onFire(); } catch { /* swallow so re-scheduling always proceeds */ }
          schedule(); // schedule next occurrence
        }, delay);
        this.timers.set(config.playbookId, handle);
      };

      schedule();
    }
  }

  /** Stop the scheduled timer for a specific playbook. */
  deactivate(playbookId: string): void {
    const handle = this.timers.get(playbookId);
    if (handle !== undefined) {
      clearTimeout(handle);
      this.timers.delete(playbookId);
    }
  }

  /** Stop all timers. */
  deactivateAll(): void {
    for (const id of [...this.timers.keys()]) {
      this.deactivate(id);
    }
  }
}
