/**
 * bin/cli.js races reportCrash() against a timeout before force-exiting, so
 * a crash handler can never hang the process indefinitely. The bound is 30s
 * only when stdin is a TTY — crash-consent.ts's promptForConsent, bounded
 * at 15s, needs that room to be answered. The non-TTY path never prompts,
 * so it keeps the original, tighter 10s bound unconditionally.
 *
 * Pure and synchronous on purpose (i-055-cli review finding 1): a test can
 * assert this directly and it cannot pass on inverted logic, unlike a
 * source-text regex or a 40-second real-timer subprocess test.
 */
export function getCrashRaceTimeoutMs(isTTY: boolean): number {
  return isTTY ? 30_000 : 10_000;
}
