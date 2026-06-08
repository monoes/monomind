export const DRIFT_MIN_FILE_AGE_DAYS = 30;
export const DRIFT_MAX_ORIGINAL_SHARE = 0.10;
export function normalizeEmail(email, mode) {
    if (mode === 'raw') {
        return email;
    }
    if (mode === 'handle') {
        const githubNoreplyMatch = email.match(/\d+\+(.+)@users\.noreply\.github\.com/);
        if (githubNoreplyMatch) {
            return githubNoreplyMatch[1];
        }
        const atIdx = email.indexOf('@');
        return atIdx >= 0 ? email.slice(0, atIdx) : email;
    }
    // mode === 'hash': FNV-1a 32-bit
    let h = 2166136261;
    for (let i = 0; i < email.length; i++) {
        const byte = email.charCodeAt(i);
        h = Math.imul(h ^ byte, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}
export function computeBusFactor(contributors) {
    if (contributors.length === 0)
        return 0;
    const sorted = [...contributors].sort((a, b) => b.weightedCommits - a.weightedCommits);
    const total = sorted.reduce((sum, c) => sum + c.weightedCommits, 0);
    if (total === 0)
        return 0;
    let cumulative = 0;
    let count = 0;
    for (const contributor of sorted) {
        cumulative += contributor.weightedCommits;
        count++;
        if (cumulative / total >= 0.5) {
            break;
        }
    }
    return count;
}
export function detectDrift(filePath, contributors, originalAuthor, fileAgeDays) {
    if (fileAgeDays < DRIFT_MIN_FILE_AGE_DAYS) {
        return false;
    }
    const totalWeighted = contributors.reduce((sum, c) => sum + c.weightedCommits, 0);
    if (totalWeighted === 0) {
        return false;
    }
    const originalEntry = contributors.find((c) => c.email === originalAuthor);
    if (!originalEntry) {
        return true;
    }
    const originalShare = originalEntry.weightedCommits / totalWeighted;
    return originalShare <= DRIFT_MAX_ORIGINAL_SHARE;
}
export function isBotEmail(email) {
    const lower = email.toLowerCase();
    return (lower.includes('bot@') ||
        lower.includes('noreply@') ||
        lower.includes('[bot]') ||
        lower.includes('dependabot') ||
        lower.includes('renovate'));
}
export function computeOwnershipMetrics(contributors, hotspotPaths, originalAuthors, fileAgeDays) {
    // Flatten all contributors across files, deduplicate by email
    const allEmails = new Set();
    const botEmails = new Set();
    for (const fileContributors of contributors) {
        for (const c of fileContributors) {
            allEmails.add(c.email);
            if (isBotEmail(c.email)) {
                botEmails.add(c.email);
            }
        }
    }
    // Compute bus factor from aggregated contributor data (across all files)
    const aggregated = new Map();
    for (const fileContributors of contributors) {
        for (const c of fileContributors) {
            if (isBotEmail(c.email))
                continue;
            const existing = aggregated.get(c.email);
            if (existing) {
                existing.weightedCommits += c.weightedCommits;
                existing.totalCommits += c.totalCommits;
            }
            else {
                aggregated.set(c.email, { ...c });
            }
        }
    }
    const aggregatedList = Array.from(aggregated.values());
    const busFactor = computeBusFactor(aggregatedList);
    // Detect drifted hotspots
    const driftedHotspots = [];
    for (let i = 0; i < hotspotPaths.length; i++) {
        const path = hotspotPaths[i];
        const fileContributors = contributors[i] ?? [];
        const originalAuthor = originalAuthors.get(path) ?? '';
        const ageDays = fileAgeDays.get(path) ?? 0;
        if (detectDrift(path, fileContributors, originalAuthor, ageDays)) {
            driftedHotspots.push(path);
        }
    }
    const humanEmails = new Set([...allEmails].filter((e) => !isBotEmail(e)));
    return {
        busFactor,
        driftedHotspots,
        contributorCount: humanEmails.size,
        botFilteredCount: botEmails.size,
    };
}
/** Normalize a raw git author string to the specified identifier format. */
export function normalizeContributorId(raw, format) {
    const email = raw.match(/<([^>]+)>/)?.[1] ?? raw;
    if (format === 'fullEmail')
        return email.toLowerCase();
    if (format === 'domainEmail') {
        const domain = email.split('@')[1] ?? email;
        return domain.toLowerCase();
    }
    // displayName: strip the <email> part if present
    return raw.replace(/<[^>]+>/, '').trim() || email;
}
//# sourceMappingURL=ownership.js.map