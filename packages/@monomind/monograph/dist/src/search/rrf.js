/**
 * Reciprocal Rank Fusion (RRF)
 *
 * Merges two ranked result lists using the formula:
 *   score(d) = sum over each list of: 1 / (K + rank_of_d_in_list)
 *
 * where rank is 1-based.
 *
 * Reference: Cormack, Clarke & Buettcher (SIGIR 2009).
 */
/**
 * Merge two ranked lists via RRF and return results sorted by fused score descending.
 *
 * @param list1 - First ranked list (ordered by relevance, best first)
 * @param list2 - Second ranked list (ordered by relevance, best first)
 * @param K     - RRF constant (default 60, per the original paper)
 */
export function mergeRanks(list1, list2, K = 60) {
    const scoreMap = new Map();
    const addList = (list) => {
        list.forEach((item, idx) => {
            const rank = idx + 1; // 1-based
            const contribution = 1 / (K + rank);
            const existing = scoreMap.get(item.id);
            if (existing) {
                existing.rrf += contribution;
            }
            else {
                scoreMap.set(item.id, { rrf: contribution, payload: item });
            }
        });
    };
    addList(list1);
    addList(list2);
    return [...scoreMap.values()]
        .sort((a, b) => b.rrf - a.rrf)
        .map(({ rrf, payload }) => ({ ...payload, score: rrf }));
}
//# sourceMappingURL=rrf.js.map