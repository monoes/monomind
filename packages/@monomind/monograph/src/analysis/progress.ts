const TICK_CHARS = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏',' '];

export interface Spinner {
  stop(finalMessage?: string): void;
}

export class AnalysisProgress {
  private readonly enabled: boolean;
  private spinners: Array<ReturnType<typeof setInterval>> = [];

  constructor(enabled: boolean) {
    this.enabled = enabled && Boolean(process.stderr.isTTY);
  }

  stageSpinner(message: string): Spinner {
    if (!this.enabled) return { stop: () => {} };
    let tick = 0;
    const interval = setInterval(() => {
      const char = TICK_CHARS[tick % TICK_CHARS.length];
      process.stderr.write(`\r\x1b[36m${char}\x1b[0m ${message}`);
      tick++;
    }, 80);
    this.spinners.push(interval);
    return {
      stop: (finalMessage?: string) => {
        clearInterval(interval);
        const idx = this.spinners.indexOf(interval);
        if (idx !== -1) this.spinners.splice(idx, 1);
        if (finalMessage) process.stderr.write(`\r${finalMessage}\n`);
        else process.stderr.write('\r\x1b[K');
      },
    };
  }

  finish(): void {
    for (const s of this.spinners) clearInterval(s);
    this.spinners = [];
  }
}

export function createAnalysisProgress(quiet: boolean): AnalysisProgress {
  return new AnalysisProgress(!quiet);
}
