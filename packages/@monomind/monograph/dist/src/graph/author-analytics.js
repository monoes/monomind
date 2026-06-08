import { execSync, spawnSync } from 'child_process';
const BOT_PATTERNS = ['[bot]', 'noreply', 'github-actions', 'dependabot', 'renovate'];
function isBot(email) {
    const lower = email.toLowerCase();
    return BOT_PATTERNS.some(p => lower.includes(p));
}
const EMPTY_REPORT = {
    authors: [],
    topOwners: [],
    botAuthors: [],
    unownedFiles: 0,
};
export function computeAuthorAnalytics(repoPath, db) {
    // ── Parse git log ──────────────────────────────────────────────────────────
    let logOutput;
    try {
        logOutput = execSync('git log --format="%ae|%ad" --date=unix', {
            cwd: repoPath,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
    }
    catch {
        return EMPTY_REPORT;
    }
    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysAgo = now - 86400 * 30;
    const sixtyDaysAgo = now - 86400 * 60;
    // commitCount, recentCommits, priorCommits per author
    const commitCount = new Map();
    const recentCommits = new Map();
    const priorCommits = new Map();
    for (const line of logOutput.split('\n')) {
        const trimmed = line.trim().replace(/^"|"$/g, '');
        if (!trimmed)
            continue;
        const pipeIdx = trimmed.indexOf('|');
        if (pipeIdx === -1)
            continue;
        const email = trimmed.slice(0, pipeIdx).trim();
        const tsStr = trimmed.slice(pipeIdx + 1).trim();
        const ts = parseInt(tsStr, 10);
        if (!email || isNaN(ts))
            continue;
        commitCount.set(email, (commitCount.get(email) ?? 0) + 1);
        if (ts > thirtyDaysAgo) {
            recentCommits.set(email, (recentCommits.get(email) ?? 0) + 1);
        }
        else if (ts > sixtyDaysAgo) {
            priorCommits.set(email, (priorCommits.get(email) ?? 0) + 1);
        }
    }
    if (commitCount.size === 0)
        return EMPTY_REPORT;
    // ── File ownership ─────────────────────────────────────────────────────────
    // Get File nodes with degree > 2
    const fileRows = db.prepare(`
    SELECT n.id, n.name, n.file_path
    FROM nodes n
    WHERE n.label = 'File'
      AND n.file_path IS NOT NULL
      AND (
        SELECT COUNT(*) FROM edges e
        WHERE e.source_id = n.id OR e.target_id = n.id
      ) > 2
    LIMIT 200
  `).all();
    // Map: file path → winning author email (majority owner) or null
    const fileOwner = new Map();
    const filesOwnedByAuthor = new Map();
    for (const file of fileRows) {
        const filePath = file.file_path;
        if (!filePath) {
            fileOwner.set(file.id, null);
            continue;
        }
        let fileLog;
        try {
            const result = spawnSync('git', ['log', '--follow', '--format=%ae', '--', filePath], {
                cwd: repoPath,
                encoding: 'utf-8',
            });
            if (result.status !== 0 || result.error) {
                fileOwner.set(file.id, null);
                continue;
            }
            fileLog = result.stdout;
        }
        catch {
            fileOwner.set(file.id, null);
            continue;
        }
        const authorCounts = new Map();
        for (const ae of fileLog.split('\n')) {
            const e = ae.trim().replace(/^"|"$/g, '');
            if (!e)
                continue;
            authorCounts.set(e, (authorCounts.get(e) ?? 0) + 1);
        }
        let totalCommitsOnFile = 0;
        for (const c of authorCounts.values())
            totalCommitsOnFile += c;
        let winner = null;
        for (const [ae, c] of authorCounts) {
            if (totalCommitsOnFile > 0 && c / totalCommitsOnFile > 0.5) {
                winner = ae;
                break;
            }
        }
        fileOwner.set(file.id, winner);
        if (winner) {
            filesOwnedByAuthor.set(winner, (filesOwnedByAuthor.get(winner) ?? 0) + 1);
        }
    }
    // ── Count unowned files ────────────────────────────────────────────────────
    let unownedFiles = 0;
    for (const owner of fileOwner.values()) {
        if (owner === null)
            unownedFiles++;
    }
    // ── Build author stats ─────────────────────────────────────────────────────
    const authors = [];
    const botAuthors = [];
    for (const [email, count] of commitCount) {
        const recent = recentCommits.get(email) ?? 0;
        const prior = priorCommits.get(email) ?? 0;
        let churnTrend;
        if (recent > prior * 1.2)
            churnTrend = 'accelerating';
        else if (recent < prior * 0.8)
            churnTrend = 'declining';
        else
            churnTrend = 'stable';
        const bot = isBot(email);
        if (bot)
            botAuthors.push(email);
        authors.push({
            author: email,
            commitCount: count,
            filesOwned: filesOwnedByAuthor.get(email) ?? 0,
            recentCommits: recent,
            churnTrend,
            isBot: bot,
        });
    }
    // Sort by filesOwned desc, then commitCount desc
    authors.sort((a, b) => b.filesOwned - a.filesOwned || b.commitCount - a.commitCount);
    const topOwners = authors.filter(a => !a.isBot).slice(0, 5);
    return { authors, topOwners, botAuthors, unownedFiles };
}
//# sourceMappingURL=author-analytics.js.map