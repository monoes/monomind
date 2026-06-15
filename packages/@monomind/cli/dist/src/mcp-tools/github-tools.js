/**
 * GitHub MCP Tools for CLI
 *
 * Real GitHub integration via `gh` CLI and `git` commands.
 * Falls back to local state management when CLI tools are unavailable.
 */
import { getProjectCwd } from './types.js';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
// Storage paths
const STORAGE_DIR = '.monomind';
const GITHUB_DIR = 'github';
const GITHUB_FILE = 'store.json';
function getGitHubDir() {
    return join(getProjectCwd(), STORAGE_DIR, GITHUB_DIR);
}
function getGitHubPath() {
    return join(getGitHubDir(), GITHUB_FILE);
}
function ensureGitHubDir() {
    const dir = getGitHubDir();
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
}
function loadGitHubStore() {
    try {
        const path = getGitHubPath();
        if (existsSync(path)) {
            return JSON.parse(readFileSync(path, 'utf-8'));
        }
    }
    catch {
        // Return empty store
    }
    return { repos: {}, prs: {}, issues: {}, version: '3.0.0' };
}
function saveGitHubStore(store) {
    ensureGitHubDir();
    const tmpPath = getGitHubPath() + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf-8');
    renameSync(tmpPath, getGitHubPath());
}
/** Run a trusted static shell command (no user input), return stdout or null on failure */
function run(cmd, cwd) {
    try {
        return execFileSync(cmd.split(' ')[0], cmd.split(' ').slice(1), { encoding: 'utf-8', timeout: 15000, cwd: cwd || getProjectCwd(), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch {
        return null;
    }
}
/** Run a command with user-provided args as separate array elements (no shell injection) */
function runSafe(cmd, args, cwd) {
    try {
        return execFileSync(cmd, args, { encoding: 'utf-8', timeout: 15000, cwd: cwd || getProjectCwd(), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    }
    catch {
        return null;
    }
}
/** Check if gh CLI is available */
function hasGhCli() {
    return run('gh --version') !== null;
}
/**
 * Validate that a MCP input value is a safe positive integer suitable for use
 * as a GitHub PR/issue number in CLI arguments.  Returns the integer value on
 * success, or null if the input is missing, non-finite, negative, zero, or
 * non-integer.  Using this guard before string-interpolating the value into a
 * command template prevents argument-injection attacks where an MCP client
 * sends a non-numeric string (e.g. "1 --label evil") that gets split into
 * extra CLI flags when `run()` tokenises the command on whitespace.
 */
function safeGitHubNumber(raw) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n !== Math.floor(n))
        return null;
    return n;
}
export const githubTools = [
    {
        name: 'github_repo_analyze',
        description: 'Analyze a GitHub repository',
        category: 'github',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                branch: { type: 'string', description: 'Branch to analyze' },
                deep: { type: 'boolean', description: 'Deep analysis' },
            },
        },
        handler: async (input) => {
            const store = loadGitHubStore();
            const branch = input.branch || 'main';
            const cwd = getProjectCwd();
            // Try real git analysis first
            const commitCount = run('git rev-list --count HEAD', cwd);
            const branchCount = run('git branch -a --no-color | wc -l', cwd);
            const contributors = run('git shortlog -sn --no-merges HEAD | wc -l', cwd);
            const currentBranch = run('git rev-parse --abbrev-ref HEAD', cwd);
            const remoteUrl = run('git remote get-url origin', cwd);
            // Parse owner/repo from remote URL
            let owner = input.owner || '';
            let repo = input.repo || '';
            if (remoteUrl && (!owner || !repo)) {
                const m = remoteUrl.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
                if (m) {
                    owner = owner || m[1];
                    repo = repo || m[2];
                }
            }
            const repoKey = `${owner || 'local'}/${repo || 'repo'}`;
            if (commitCount !== null) {
                // Real git data available
                const repoInfo = {
                    owner: owner || 'local',
                    name: repo || 'repo',
                    branch: currentBranch || branch,
                    lastAnalyzed: new Date().toISOString(),
                    metrics: {
                        commits: parseInt(commitCount, 10) || 0,
                        branches: parseInt(branchCount || '0', 10) || 0,
                        contributors: parseInt(contributors || '0', 10) || 0,
                        openIssues: 0,
                        openPRs: 0,
                    },
                };
                // Try gh CLI for issue/PR counts
                if (hasGhCli()) {
                    const issueCount = run(`gh issue list --state open --limit 1000 --json number --jq 'length'`);
                    const prCount = run(`gh pr list --state open --limit 1000 --json number --jq 'length'`);
                    if (issueCount !== null)
                        repoInfo.metrics.openIssues = parseInt(issueCount, 10) || 0;
                    if (prCount !== null)
                        repoInfo.metrics.openPRs = parseInt(prCount, 10) || 0;
                }
                store.repos[repoKey] = repoInfo;
                saveGitHubStore(store);
                return {
                    success: true,
                    _real: true,
                    repository: repoKey,
                    branch: repoInfo.branch,
                    metrics: repoInfo.metrics,
                    remoteUrl: remoteUrl || null,
                    lastAnalyzed: repoInfo.lastAnalyzed,
                };
            }
            // No git — return local store data
            return {
                success: false,
                error: 'Not a git repository or git not available.',
                localData: { storedRepos: Object.keys(store.repos) },
            };
        },
    },
    {
        name: 'github_pr_manage',
        description: 'Manage pull requests',
        category: 'github',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'review', 'merge', 'close'], description: 'Action to perform' },
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                prNumber: { type: 'number', description: 'PR number' },
                title: { type: 'string', description: 'PR title' },
                branch: { type: 'string', description: 'Source branch' },
                baseBranch: { type: 'string', description: 'Target branch' },
                body: { type: 'string', description: 'PR description' },
            },
        },
        handler: async (input) => {
            const store = loadGitHubStore();
            const action = input.action || 'list';
            const gh = hasGhCli();
            if (action === 'list') {
                if (gh) {
                    const raw = run('gh pr list --state all --limit 20 --json number,title,state,headRefName,createdAt');
                    if (raw) {
                        try {
                            const prs = JSON.parse(raw);
                            return { success: true, _real: true, source: 'gh-cli', pullRequests: prs, total: prs.length };
                        }
                        catch { /* fall through */ }
                    }
                }
                const prs = Object.values(store.prs);
                return { success: true, source: 'local-store', pullRequests: prs, total: prs.length, open: prs.filter(pr => pr.status === 'open').length };
            }
            if (action === 'create') {
                // Cap PR fields: title/branch/baseBranch are passed as CLI args to gh
                // (runSafe — no injection risk) and stored in the local JSON store on
                // disk; body is also stored and can be very large.
                const MAX_PR_TITLE_LEN = 256;
                const MAX_PR_BRANCH_LEN = 256;
                const MAX_PR_BODY_LEN = 64 * 1024; // 64 KB — typical PR body limit
                const rawPrTitle = input.title || 'New PR';
                const title = rawPrTitle.length > MAX_PR_TITLE_LEN ? rawPrTitle.slice(0, MAX_PR_TITLE_LEN) : rawPrTitle;
                const rawHeadBranch = input.branch || run('git rev-parse --abbrev-ref HEAD') || 'feature';
                const headBranch = rawHeadBranch.length > MAX_PR_BRANCH_LEN ? rawHeadBranch.slice(0, MAX_PR_BRANCH_LEN) : rawHeadBranch;
                const rawBaseBranch = input.baseBranch || 'main';
                const baseBranch = rawBaseBranch.length > MAX_PR_BRANCH_LEN ? rawBaseBranch.slice(0, MAX_PR_BRANCH_LEN) : rawBaseBranch;
                const rawPrBody = input.body || '';
                const body = rawPrBody.length > MAX_PR_BODY_LEN ? rawPrBody.slice(0, MAX_PR_BODY_LEN) : rawPrBody;
                if (gh) {
                    const result = runSafe('gh', ['pr', 'create', '--title', title, '--base', baseBranch, '--head', headBranch, '--body', body]);
                    if (result) {
                        return { success: true, _real: true, action: 'created', url: result };
                    }
                }
                // Fallback: local store
                const prId = `pr-${Date.now()}`;
                const pr = { id: prId, title, status: 'open', branch: headBranch, baseBranch, createdAt: new Date().toISOString() };
                store.prs[prId] = pr;
                saveGitHubStore(store);
                return { success: true, source: 'local-store', action: 'created', pullRequest: pr };
            }
            if (action === 'review') {
                const prNumber = safeGitHubNumber(input.prNumber);
                if (!prNumber)
                    return { success: false, error: 'prNumber is required and must be a positive integer for review.' };
                if (gh) {
                    const raw = runSafe('gh', ['pr', 'view', String(prNumber), '--json', 'number,title,state,body,additions,deletions,changedFiles,reviews,mergeable,statusCheckRollup']);
                    if (raw) {
                        try {
                            return { success: true, _real: true, action: 'review', pullRequest: JSON.parse(raw) };
                        }
                        catch { /* fall through */ }
                    }
                }
                return { success: false, error: 'gh CLI not available or PR not found. Install gh: https://cli.github.com' };
            }
            if (action === 'merge') {
                const prNumber = safeGitHubNumber(input.prNumber);
                if (!prNumber)
                    return { success: false, error: 'prNumber is required and must be a positive integer for merge.' };
                if (gh) {
                    const result = runSafe('gh', ['pr', 'merge', String(prNumber), '--merge']);
                    if (result !== null) {
                        return { success: true, _real: true, action: 'merged', prNumber, mergedAt: new Date().toISOString() };
                    }
                }
                // Fallback: local store
                const prKey = Object.keys(store.prs).find(k => k.includes(String(prNumber)));
                if (prKey && store.prs[prKey]) {
                    store.prs[prKey].status = 'merged';
                    saveGitHubStore(store);
                }
                return { success: true, source: 'local-store', action: 'merged', prNumber, mergedAt: new Date().toISOString() };
            }
            if (action === 'close') {
                const prNumber = safeGitHubNumber(input.prNumber);
                if (!prNumber)
                    return { success: false, error: 'prNumber is required and must be a positive integer for close.' };
                if (gh) {
                    const result = runSafe('gh', ['pr', 'close', String(prNumber)]);
                    if (result !== null) {
                        return { success: true, _real: true, action: 'closed', prNumber, closedAt: new Date().toISOString() };
                    }
                }
                const prKey = Object.keys(store.prs).find(k => k.includes(String(prNumber)));
                if (prKey && store.prs[prKey]) {
                    store.prs[prKey].status = 'closed';
                    saveGitHubStore(store);
                }
                return { success: true, source: 'local-store', action: 'closed', prNumber, closedAt: new Date().toISOString() };
            }
            return { success: false, error: 'Unknown action' };
        },
    },
    {
        name: 'github_issue_track',
        description: 'Track and manage issues',
        category: 'github',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'create', 'update', 'close', 'assign'], description: 'Action to perform' },
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                issueNumber: { type: 'number', description: 'Issue number' },
                title: { type: 'string', description: 'Issue title' },
                body: { type: 'string', description: 'Issue body' },
                labels: { type: 'array', items: { type: 'string' }, description: 'Issue labels' },
                assignees: { type: 'array', items: { type: 'string' }, description: 'Assignees' },
            },
        },
        handler: async (input) => {
            const store = loadGitHubStore();
            const action = input.action || 'list';
            const gh = hasGhCli();
            if (action === 'list') {
                if (gh) {
                    const raw = run('gh issue list --state all --limit 20 --json number,title,state,labels,createdAt');
                    if (raw) {
                        try {
                            const issues = JSON.parse(raw);
                            return { success: true, _real: true, source: 'gh-cli', issues, total: issues.length };
                        }
                        catch { /* fall through */ }
                    }
                }
                const issues = Object.values(store.issues);
                return { success: true, source: 'local-store', issues, total: issues.length, open: issues.filter(i => i.status === 'open').length };
            }
            if (action === 'create') {
                // Cap issue fields: stored in local JSON store and passed as CLI args
                // to gh (runSafe — no injection risk).
                const MAX_ISSUE_TITLE_LEN = 256;
                const MAX_ISSUE_BODY_LEN = 64 * 1024;
                const MAX_ISSUE_LABELS = 20;
                const MAX_ISSUE_LABEL_LEN = 128;
                const rawIssueTitle = input.title || 'New Issue';
                const title = rawIssueTitle.length > MAX_ISSUE_TITLE_LEN ? rawIssueTitle.slice(0, MAX_ISSUE_TITLE_LEN) : rawIssueTitle;
                const rawIssueBody = input.body || '';
                const body = rawIssueBody.length > MAX_ISSUE_BODY_LEN ? rawIssueBody.slice(0, MAX_ISSUE_BODY_LEN) : rawIssueBody;
                const rawLabels = input.labels || [];
                const labels = Array.isArray(rawLabels)
                    ? rawLabels.slice(0, MAX_ISSUE_LABELS).map(l => typeof l === 'string' && l.length > MAX_ISSUE_LABEL_LEN ? l.slice(0, MAX_ISSUE_LABEL_LEN) : l)
                    : [];
                if (gh) {
                    const issueArgs = ['issue', 'create', '--title', title, '--body', body];
                    if (labels.length > 0)
                        issueArgs.push('--label', labels.join(','));
                    const result = runSafe('gh', issueArgs);
                    if (result) {
                        return { success: true, _real: true, action: 'created', url: result };
                    }
                }
                const issueId = `issue-${Date.now()}`;
                const issue = { id: issueId, title, status: 'open', labels, createdAt: new Date().toISOString() };
                store.issues[issueId] = issue;
                saveGitHubStore(store);
                return { success: true, source: 'local-store', action: 'created', issue };
            }
            if (action === 'update') {
                const issueNumber = input.issueNumber;
                if (gh && issueNumber) {
                    const editArgs = ['issue', 'edit', String(issueNumber)];
                    // Cap title and labels to prevent inflating args and local store
                    const MAX_UPDATE_TITLE_LEN = 256;
                    if (input.title) {
                        const t = input.title;
                        editArgs.push('--title', t.length > MAX_UPDATE_TITLE_LEN ? t.slice(0, MAX_UPDATE_TITLE_LEN) : t);
                    }
                    if (input.labels)
                        editArgs.push('--add-label', input.labels.join(','));
                    if (editArgs.length > 3) {
                        const result = runSafe('gh', editArgs);
                        if (result !== null)
                            return { success: true, _real: true, action: 'updated', issueNumber };
                    }
                }
                const issueKey = Object.keys(store.issues).find(k => k.includes(String(issueNumber)));
                if (issueKey && store.issues[issueKey]) {
                    if (input.title) {
                        const t = input.title;
                        store.issues[issueKey].title = t.length > 256 ? t.slice(0, 256) : t;
                    }
                    if (input.labels)
                        store.issues[issueKey].labels = input.labels;
                    saveGitHubStore(store);
                }
                return { success: true, source: 'local-store', action: 'updated', issueNumber };
            }
            if (action === 'close') {
                const issueNumber = safeGitHubNumber(input.issueNumber);
                if (!issueNumber)
                    return { success: false, error: 'issueNumber is required and must be a positive integer for close.' };
                if (gh) {
                    const result = runSafe('gh', ['issue', 'close', String(issueNumber)]);
                    if (result !== null)
                        return { success: true, _real: true, action: 'closed', issueNumber, closedAt: new Date().toISOString() };
                }
                const issueKey = Object.keys(store.issues).find(k => k.includes(String(issueNumber)));
                if (issueKey && store.issues[issueKey]) {
                    store.issues[issueKey].status = 'closed';
                    saveGitHubStore(store);
                }
                return { success: true, source: 'local-store', action: 'closed', issueNumber, closedAt: new Date().toISOString() };
            }
            return { success: false, error: 'Unknown action' };
        },
    },
    {
        name: 'github_workflow',
        description: 'Manage GitHub Actions workflows',
        category: 'github',
        inputSchema: {
            type: 'object',
            properties: {
                action: { type: 'string', enum: ['list', 'trigger', 'status', 'cancel'], description: 'Action to perform' },
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                workflowId: { type: 'string', description: 'Workflow ID or name' },
                ref: { type: 'string', description: 'Branch or tag ref' },
            },
        },
        handler: async (input) => {
            const action = input.action || 'list';
            const gh = hasGhCli();
            if (!gh) {
                return { success: false, error: 'gh CLI not available. Install: https://cli.github.com' };
            }
            if (action === 'list') {
                const raw = run('gh run list --limit 10 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt');
                if (raw) {
                    try {
                        return { success: true, _real: true, runs: JSON.parse(raw) };
                    }
                    catch { /* fall through */ }
                }
                const workflows = run('gh workflow list --json id,name,state');
                if (workflows) {
                    try {
                        return { success: true, _real: true, workflows: JSON.parse(workflows) };
                    }
                    catch { /* fall through */ }
                }
            }
            if (action === 'status') {
                const workflowId = input.workflowId;
                if (workflowId) {
                    const raw = runSafe('gh', ['run', 'view', workflowId, '--json', 'databaseId,displayTitle,status,conclusion,jobs']);
                    if (raw) {
                        try {
                            return { success: true, _real: true, run: JSON.parse(raw) };
                        }
                        catch { /* fall through */ }
                    }
                }
                // List recent runs as fallback
                const recent = run('gh run list --limit 5 --json databaseId,displayTitle,status,conclusion');
                if (recent) {
                    try {
                        return { success: true, _real: true, recentRuns: JSON.parse(recent) };
                    }
                    catch { /* fall through */ }
                }
            }
            if (action === 'trigger') {
                const workflowId = input.workflowId;
                const ref = input.ref || 'main';
                if (workflowId) {
                    const result = runSafe('gh', ['workflow', 'run', workflowId, '--ref', ref]);
                    if (result !== null)
                        return { success: true, _real: true, action: 'triggered', workflowId, ref };
                }
                return { success: false, error: 'workflowId is required to trigger a workflow.' };
            }
            if (action === 'cancel') {
                const workflowId = input.workflowId;
                if (workflowId) {
                    const result = runSafe('gh', ['run', 'cancel', workflowId]);
                    if (result !== null)
                        return { success: true, _real: true, action: 'cancelled', runId: workflowId };
                }
                return { success: false, error: 'workflowId (run ID) is required to cancel.' };
            }
            return { success: false, error: `Unknown action: ${action}` };
        },
    },
    {
        name: 'github_metrics',
        description: 'Get repository metrics and statistics',
        category: 'github',
        inputSchema: {
            type: 'object',
            properties: {
                owner: { type: 'string', description: 'Repository owner' },
                repo: { type: 'string', description: 'Repository name' },
                metric: { type: 'string', enum: ['all', 'commits', 'contributors', 'traffic', 'releases'], description: 'Metric type' },
                timeRange: { type: 'string', description: 'Time range (e.g., "7d", "30d", "90d")' },
            },
        },
        handler: async (input) => {
            const metric = input.metric || 'all';
            const timeRange = input.timeRange || '30d';
            const cwd = getProjectCwd();
            // Parse time range
            const days = parseInt(timeRange, 10) || 30;
            const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
            const result = { _real: true, timeRange: `${days}d`, since };
            const wantAll = metric === 'all';
            if (wantAll || metric === 'commits') {
                const total = run(`git rev-list --count HEAD`, cwd);
                const recent = run(`git rev-list --count --since="${since}" HEAD`, cwd);
                result.commits = {
                    total: parseInt(total || '0', 10),
                    sincePeriod: parseInt(recent || '0', 10),
                };
            }
            if (wantAll || metric === 'contributors') {
                const allContrib = run('git shortlog -sn --no-merges HEAD', cwd);
                if (allContrib) {
                    const lines = allContrib.split('\n').filter(Boolean);
                    result.contributors = {
                        total: lines.length,
                        top: lines.slice(0, 10).map(l => {
                            const m = l.trim().match(/^(\d+)\t(.+)$/);
                            return m ? { commits: parseInt(m[1], 10), name: m[2].trim() } : null;
                        }).filter(Boolean),
                    };
                }
            }
            if (wantAll || metric === 'releases') {
                if (hasGhCli()) {
                    const raw = run('gh release list --limit 10 --json tagName,name,publishedAt,isPrerelease');
                    if (raw) {
                        try {
                            result.releases = JSON.parse(raw);
                        }
                        catch { /* skip */ }
                    }
                }
                if (!result.releases) {
                    const tags = run('git tag --sort=-creatordate | head -10', cwd);
                    result.releases = tags ? tags.split('\n').filter(Boolean).map(t => ({ tagName: t })) : [];
                }
            }
            // Always include branch info
            const branchCount = run('git branch -a --no-color | wc -l', cwd);
            const currentBranch = run('git rev-parse --abbrev-ref HEAD', cwd);
            result.branches = { total: parseInt(branchCount || '0', 10), current: currentBranch };
            return { success: true, ...result };
        },
    },
];
//# sourceMappingURL=github-tools.js.map