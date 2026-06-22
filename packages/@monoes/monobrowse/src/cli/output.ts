const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
} as const;

class OutputFormatter {
  private colorEnabled = process.stdout.isTTY ?? false;

  private c(color: keyof typeof COLORS, text: string): string {
    if (!this.colorEnabled) return text;
    return `${COLORS[color]}${text}${COLORS.reset}`;
  }

  printSuccess(message: string): void {
    console.log(this.c('green', '✓') + ' ' + message);
  }

  printError(message: string, details?: string): void {
    console.error(this.c('red', '✗') + ' ' + message);
    if (details) console.error(this.c('red', '  ' + details));
  }

  printWarning(message: string): void {
    console.warn(this.c('yellow', '⚠') + ' ' + message);
  }

  printInfo(message: string): void {
    console.log(this.c('cyan', 'ℹ') + ' ' + message);
  }
}

export const output = new OutputFormatter();
