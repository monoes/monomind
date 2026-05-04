export interface ConcatenationResult {
  text: number[];
  fileOf: number[];
  fileOffsets: number[];
}

export function concatenateWithSentinels(
  fileTokens: Array<{ fileId: number; tokens: number[] }>,
): ConcatenationResult {
  const sentinelCount = Math.max(0, fileTokens.length - 1);
  const totalLen = fileTokens.reduce((s, f) => s + f.tokens.length, 0) + sentinelCount;

  const text: number[] = [];
  const fileOf: number[] = [];
  const fileOffsets: number[] = [];

  let sentinel = -1;

  for (let i = 0; i < fileTokens.length; i++) {
    const { fileId, tokens } = fileTokens[i];
    fileOffsets.push(text.length);

    for (const r of tokens) {
      text.push(r);
      fileOf.push(fileId);
    }

    if (i + 1 < fileTokens.length) {
      text.push(sentinel);
      fileOf.push(-1);
      sentinel -= 1;
    }
  }

  void totalLen;
  return { text, fileOf, fileOffsets };
}
