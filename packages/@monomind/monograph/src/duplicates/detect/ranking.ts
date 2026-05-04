export function rankReduce(tokens: number[]): { ranked: number[]; maxRank: number } {
  const hashToRank = new Map<number, number>();
  let nextRank = 0;

  const ranked = tokens.map((token) => {
    let rank = hashToRank.get(token);
    if (rank === undefined) {
      rank = nextRank++;
      hashToRank.set(token, rank);
    }
    return rank;
  });

  const maxRank = nextRank === 0 ? 0 : nextRank - 1;
  return { ranked, maxRank };
}
