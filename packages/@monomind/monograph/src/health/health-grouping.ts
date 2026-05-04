export interface HealthGroup {
  name: string;
  files: string[];
  fileCount: number;
  score: number;
  grade: string;
  totalLines: number;
  unusedExports: number;
  circularDeps: number;
}

export interface HealthGrouping {
  groups: HealthGroup[];
  totalFiles: number;
  averageScore: number;
}

export function groupFilesByOwner(
  files: Array<{ filePath: string }>,
  resolveOwner: (filePath: string) => string,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const { filePath } of files) {
    const owner = resolveOwner(filePath);
    const list = result.get(owner);
    if (list != null) {
      list.push(filePath);
    } else {
      result.set(owner, [filePath]);
    }
  }
  return result;
}

export function computeGroupScore(
  files: string[],
  scoreMap: Map<string, number>,
): number {
  const known = files.filter(f => scoreMap.has(f));
  if (known.length === 0) return 100;
  const sum = known.reduce((acc, f) => acc + scoreMap.get(f)!, 0);
  return sum / known.length;
}

function gradeFromScore(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function buildHealthGrouping(
  files: string[],
  resolveOwner: (filePath: string) => string,
  scoreMap: Map<string, number>,
  lineCountMap: Map<string, number>,
): HealthGrouping {
  const grouped = groupFilesByOwner(files.map(f => ({ filePath: f })), resolveOwner);

  const groups: HealthGroup[] = [];
  for (const [owner, ownerFiles] of grouped.entries()) {
    const score = computeGroupScore(ownerFiles, scoreMap);
    const totalLines = ownerFiles.reduce((sum, f) => sum + (lineCountMap.get(f) ?? 0), 0);
    groups.push({
      name: owner,
      files: ownerFiles,
      fileCount: ownerFiles.length,
      score,
      grade: gradeFromScore(score),
      totalLines,
      unusedExports: 0,
      circularDeps: 0,
    });
  }

  groups.sort((a, b) => b.score - a.score);

  const totalFiles = files.length;
  const averageScore =
    groups.length > 0
      ? groups.reduce((sum, g) => sum + g.score * g.fileCount, 0) / Math.max(totalFiles, 1)
      : 100;

  return { groups, totalFiles, averageScore };
}
