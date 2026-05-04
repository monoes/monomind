export type EntryPointCategory = "all" | "runtime" | "test";

export interface CategorizedEntryPoints {
  all: string[];
  runtime: string[];
  test: string[];
}

export const OUTPUT_DIRS: string[] = ["dist", "build", "out", "esm", "cjs", ".next", ".nuxt", ".output"];

export function isTestEntryPoint(filePath: string): boolean {
  return (
    filePath.includes("/__tests__/") ||
    filePath.includes(".test.") ||
    filePath.includes(".spec.") ||
    filePath.includes("/test/") ||
    filePath.includes("/tests/")
  );
}

export function categorizeEntryPoints(entryPoints: string[]): CategorizedEntryPoints {
  const result: CategorizedEntryPoints = { all: [], runtime: [], test: [] };

  for (const ep of entryPoints) {
    result.all.push(ep);
    if (isTestEntryPoint(ep)) {
      result.test.push(ep);
    } else {
      result.runtime.push(ep);
    }
  }

  return result;
}

export function formatSkippedEntryWarning(filePath: string, reason: string): string {
  return `Skipped entry point ${filePath}: ${reason}`;
}

export function deduplicateEntryPoints(entries: string[]): string[] {
  return [...new Set(entries)];
}
