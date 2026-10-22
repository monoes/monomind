export class StructuredLogger {
  write(level: string, message: string): string {
    return JSON.stringify({ level, message });
  }
}
