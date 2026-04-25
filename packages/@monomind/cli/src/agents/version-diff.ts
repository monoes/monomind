/**
 * Agent Version Diff Utility (Task 29)
 *
 * Computes a simple unified-style diff between two content strings.
 */

export interface LineDiffResult {
  additions: number;
  deletions: number;
  hunks: string;
}

/**
 * Compute a unified diff between two content strings.
 *
 * Uses a simple line-by-line LCS-based approach to produce
 * addition/deletion counts and a unified-style hunk string.
 */
export function computeUnifiedDiff(
  oldContent: string,
  newContent: string,
): LineDiffResult {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Simple LCS to find common subsequence
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff lines
  const diffLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let i = m;
  let j = n;

  const result: Array<{ type: ' ' | '-' | '+'; line: string }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: ' ', line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: '+', line: newLines[j - 1] });
      additions++;
      j--;
    } else {
      result.push({ type: '-', line: oldLines[i - 1] });
      deletions++;
      i--;
    }
  }

  result.reverse();

  for (const entry of result) {
    diffLines.push(`${entry.type} ${entry.line}`);
  }

  return {
    additions,
    deletions,
    hunks: diffLines.join('\n'),
  };
}
