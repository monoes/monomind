export const BOT_PATTERNS = [
    /dependabot/i,
    /renovate/i,
    /github-actions/i,
    /\[bot\]/i,
    /greenkeeper/i,
    /snyk-bot/i,
    /semantic-release-bot/i,
    /allcontributors/i,
];
export function isBot(email, name) {
    const target = name != null ? `${email} ${name}` : email;
    return BOT_PATTERNS.some(p => p.test(target));
}
export function computeBusFactor(contributors) {
    const total = contributors.reduce((sum, c) => sum + c.commits, 0);
    if (total === 0)
        return 0;
    const sorted = [...contributors].sort((a, b) => b.commits - a.commits);
    let acc = 0;
    let count = 0;
    for (const c of sorted) {
        acc += c.commits;
        count++;
        if (acc / total >= 0.5)
            break;
    }
    return count;
}
const STALE_DAYS_THRESHOLD = 180;
const MS_PER_DAY = 86_400_000;
export function computeOwnershipRisk(contributors, referenceDate) {
    const now = referenceDate != null ? new Date(referenceDate).getTime() : Date.now();
    const human = contributors.filter(c => !isBot(c.email));
    if (human.length === 0) {
        return {
            busFactor: 0,
            contributorCount: 0,
            topContributorShare: 0,
            isDrifted: false,
            isStale: true,
            staleDays: Infinity,
        };
    }
    const total = human.reduce((sum, c) => sum + c.commits, 0);
    const sorted = [...human].sort((a, b) => b.commits - a.commits);
    const busFactor = computeBusFactor(human);
    const top = sorted[0];
    const topContributorShare = total > 0 ? top.commits / total : 0;
    const lastCommitMs = new Date(top.lastCommit).getTime();
    const staleDays = Math.max(0, Math.floor((now - lastCommitMs) / MS_PER_DAY));
    const isStale = staleDays > STALE_DAYS_THRESHOLD;
    // Drift: current top-committer differs from the contributor with the oldest last-commit
    // (proxy for "original owner" when first-commit timestamps aren't available).
    const byAge = [...human].sort((a, b) => new Date(a.lastCommit).getTime() - new Date(b.lastCommit).getTime());
    const originalTop = byAge[0];
    const isDrifted = sorted.length > 1 && originalTop !== undefined && originalTop.email !== sorted[0].email;
    return {
        busFactor,
        contributorCount: human.length,
        topContributor: top.email,
        topContributorShare,
        isDrifted,
        isStale,
        staleDays,
    };
}
//# sourceMappingURL=ownership-risk.js.map