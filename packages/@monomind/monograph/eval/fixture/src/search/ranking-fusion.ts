export function fuseRankings(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}
