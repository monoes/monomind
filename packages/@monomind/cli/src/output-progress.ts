/**
 * CLI Output Formatter — progress bar
 *
 * Split out of output.ts (file-size sweep). Pure move: no behaviour change.
 */

import type { OutputFormatter } from './output.js';
import type { ProgressOptions } from './types.js';

export class Progress {
  private current: number;
  private total: number;
  private width: number;
  private startTime: number;
  private formatter: OutputFormatter;
  private showETA: boolean;
  private lastRender: string = '';

  constructor(formatter: OutputFormatter, options: ProgressOptions) {
    this.formatter = formatter;
    this.current = options.current ?? 0;
    this.total = options.total;
    this.width = options.width ?? 40;
    this.showETA = options.showETA ?? true;
    this.startTime = Date.now();
  }

  update(current: number): void {
    this.current = current;
    this.render();
  }

  increment(amount: number = 1): void {
    this.update(this.current + amount);
  }

  render(): void {
    const bar = this.formatter.progressBar(this.current, this.total, this.width);

    let output = bar;

    if (this.showETA && this.current > 0) {
      const elapsed = Date.now() - this.startTime;
      const rate = this.current / elapsed;
      const remaining = this.total - this.current;
      const eta = remaining / rate;

      if (Number.isFinite(eta)) {
        output += ` ETA: ${this.formatTime(eta)}`;
      }
    }

    // Clear previous line and write new. stderr, like the spinner: progress
    // is status, never part of a command's stdout result (#495).
    if (this.lastRender) {
      this.formatter.writeError(`\r${' '.repeat(this.lastRender.length)}\r`);
    }

    this.formatter.writeError(output);
    this.lastRender = output;
  }

  finish(): void {
    this.current = this.total;
    this.render();
    this.formatter.writeError('\n');
  }

  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
