/**
 * GitHub MCP Tools for CLI
 *
 * Real GitHub integration via `gh` CLI and `git` commands.
 * Falls back to local state management when CLI tools are unavailable.
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// Storage paths
const STORAGE_DIR = '.monobrain';
const GITHUB_DIR = 'github';
const GITHUB_FILE = 'store.json';

interface RepoInfo {
  owner: string;
  name: string;
  branch: string;
  lastAnalyzed?: string;
  metrics?: {
    commits: number;
    branches: number;
    contributors: number;
    openIssues: number;
    openPRs: number;
  };
}

interface GitHubStore {
  repos: Record<string, RepoInfo>;
  prs: Record<string, { id: string; title: string; status: string; branch: string; createdAt: string }>;
  issues: Record<string, { id: string; title: string; status: string; labels: string[]; createdAt: string }>;
  version: string;
}

function getGitHubDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, GITHUB_DIR);
}

function getGitHubPath(): string {
  return join(getGitHubDir(), GITHUB_FILE);
}

function ensureGitHubDir(): void {
  const dir = getGitHubDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadGitHubStore(): GitHubStore {
  try {
    const path = getGitHubPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return empty store
  }
  return { repos: {}, prs: {}, issues: {}, version: '3.0.0' };
}

function saveGitHubStore(store: GitHubStore): void {
  ensureGitHubDir();
  writeFileSync(getGitHubPath(), JSON.stringify(store, null, 2), 'utf-8');
}

/** Run a shell command, return stdout or null on failure */
function run(cmd: string, cwd?: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf-8', timeout: 15000, cwd: cwd || getProjectCwd(), stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/** Check if gh CLI is available */
function hasGhCli(): boolean {
  return run('gh --version') !== null;
}

export const githubTools: MCPTool[] = [
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
      const branch = (input.branch as string) || 'main';
      const cwd = getProjectCwd();

      // Try real git analysis first
      const commitCount = run('git rev-list --count HEAD', cwd);
      const branchCount = run('git branch -a --no-color | wc -l', cwd);
      const contributors = run('git shortlog -sn --no-merges HEAD | wc -l', cwd);
      const currentBranch = run('git rev-parse --abbrev-ref HEAD', cwd);
      const remoteUrl = run('git remote get-url origin', cwd);

      // Parse owner/repo from remote URL
      let owner = (input.owner as string) || '';
      let repo = (input.repo as string) || '';
      if (remoteUrl && (!owner || !repo)) {
        const m = remoteUrl.match(/[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
        if (m) { owner = owner || m[1]; repo = repo || m[2]; }
      }
      const repoKey = `${owner || 'local'}/${repo || 'repo'}`;

      if (commitCount !== null) {
        // Real git data available
        const repoInfo: RepoInfo = {
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
          if (issueCount !== null) repoInfo.metrics!.openIssues = parseInt(issueCount, 10) || 0;
          if (prCount !== null) repoInfo.metrics!.openPRs = parseInt(prCount, 10) || 0;
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
      const action = (input.action as string) || 'list';
      const gh = hasGhCli();

      if (action === 'list') {
        if (gh) {
          const raw = run('gh pr list --state all --limit 20 --json number,title,state,headRefName,createdAt');
          if (raw) {
            try {
              const prs = JSON.parse(raw);
              return { success: true, _real: true, source: 'gh-cli', pullRequests: prs, total: prs.length };
            } catch { /* fall through */ }
          }
        }
        const prs = Object.values(store.prs);
        return { success: true, source: 'local-store', pullRequests: prs, total: prs.length, open: prs.filter(pr => pr.status === 'open').length };
      }

      if (action === 'create') {
        if (gh) {
          const title = (input.title as string) || 'New PR';
          const headBranch = (input.branch as string) || run('git rev-parse --abbrev-ref HEAD') || 'feature';
          const baseBranch = (input.baseBranch as string) || 'main';
          const body = (input.body as string) || '';
          const result = run(`gh pr create --title "${title.replace(/"/g, '\\"')}" --base "${baseBranch}" --head "${headBranch}" --body "${body.replace(/"/g, '\\"')}"`);
          if (result) {
            return { success: true, _real: true, action: 'created', url: result };
          }
        }
        // Fallback: local store
        const prId = `pr-${Date.now()}`;
        const pr = { id: prId, title: (input.title as string) || 'New PR', status: 'open', branch: (input.branch as string) || 'feature', baseBranch: (input.baseBranch as string) || 'main', createdAt: new Date().toISOString() };
        store.prs[prId] = pr;
        saveGitHubStore(store);
        return { success: true, source: 'local-store', action: 'created', pullRequest: pr };
      }

      if (action === 'review') {
        const prNumber = input.prNumber as number;
        if (gh && prNumber) {
          const raw = run(`gh pr view ${prNumber} --json number,title,state,body,additions,deletions,changedFiles,reviews,mergeable,statusCheckRollup`);
          if (raw) {
            try {
              return { success: true, _real: true, action: 'review', pullRequest: JSON.parse(raw) };
            } catch { /* fall through */ }
          }
        }
        return { success: false, error: prNumber ? 'gh CLI not available or PR not found. Install gh: https://cli.github.com' : 'prNumber is required for review.' };
      }

      if (action === 'merge') {
        const prNumber = input.prNumber as number;
        if (gh && prNumber) {
          const result = run(`gh pr merge ${prNumber} --merge`);
          if (result !== null) {
            return { success: true, _real: true, action: 'merged', prNumber, mergedAt: new Date().toISOString() };
          }
        }
        // Fallback: local store
        const prKey = Object.keys(store.prs).find(k => k.includes(String(prNumber)));
        if (prKey && store.prs[prKey]) { store.prs[prKey].status = 'merged'; saveGitHubStore(store); }
        return { success: true, source: 'local-store', action: 'merged', prNumber, mergedAt: new Date().toISOString() };
      }

      if (action === 'close') {
        const prNumber = input.prNumber as number;
        if (gh && prNumber) {
          const result = run(`gh pr close ${prNumber}`);
          if (result !== null) {
            return { success: true, _real: true, action: 'closed', prNumber, closedAt: new Date().toISOString() };
          }
        }
        const prKey = Object.keys(store.prs).find(k => k.includes(String(prNumber)));
        if (prKey && store.prs[prKey]) { store.prs[prKey].status = 'closed'; saveGitHubStore(store); }
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
      const action = (input.action as string) || 'list';
      const gh = hasGhCli();

      if (action === 'list') {
        if (gh) {
          const raw = run('gh issue list --state all --limit 20 --json number,title,state,labels,createdAt');
          if (raw) {
            try {
              const issues = JSON.parse(raw);
              return { success: true, _real: true, source: 'gh-cli', issues, total: issues.length };
            } catch { /* fall through */ }
          }
        }
        const issues = Object.values(store.issues);
        return { success: true, source: 'local-store', issues, total: issues.length, open: issues.filter(i => i.status === 'open').length };
      }

      if (action === 'create') {
        const title = (input.title as string) || 'New Issue';
        const body = (input.body as string) || '';
        const labels = (input.labels as string[]) || [];
        if (gh) {
          const labelArg = labels.length > 0 ? ` --label "${labels.join(',')}"` : '';
          const result = run(`gh issue create --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"${labelArg}`);
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
        const issueNumber = input.issueNumber as number;
        if (gh && issueNumber) {
          const parts: string[] = [];
          if (input.title) parts.push(`--title "${(input.title as string).replace(/"/g, '\\"')}"`);
          if (input.labels) parts.push(`--add-label "${(input.labels as string[]).join(',')}"`);
          if (parts.length > 0) {
            const result = run(`gh issue edit ${issueNumber} ${parts.join(' ')}`);
            if (result !== null) return { success: true, _real: true, action: 'updated', issueNumber };
          }
        }
        const issueKey = Object.keys(store.issues).find(k => k.includes(String(issueNumber)));
        if (issueKey && store.issues[issueKey]) {
          if (input.title) store.issues[issueKey].title = input.title as string;
          if (input.labels) store.issues[issueKey].labels = input.labels as string[];
          saveGitHubStore(store);
        }
        return { success: true, source: 'local-store', action: 'updated', issueNumber };
      }

      if (action === 'close') {
        const issueNumber = input.issueNumber as number;
        if (gh && issueNumber) {
          const result = run(`gh issue close ${issueNumber}`);
          if (result !== null) return { success: true, _real: true, action: 'closed', issueNumber, closedAt: new Date().toISOString() };
        }
        const issueKey = Object.keys(store.issues).find(k => k.includes(String(issueNumber)));
        if (issueKey && store.issues[issueKey]) { store.issues[issueKey].status = 'closed'; saveGitHubStore(store); }
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
      const action = (input.action as string) || 'list';
      const gh = hasGhCli();

      if (!gh) {
        return { success: false, error: 'gh CLI not available. Install: https://cli.github.com' };
      }

      if (action === 'list') {
        const raw = run('gh run list --limit 10 --json databaseId,displayTitle,status,conclusion,headBranch,createdAt');
        if (raw) {
          try {
            return { success: true, _real: true, runs: JSON.parse(raw) };
          } catch { /* fall through */ }
        }
        const workflows = run('gh workflow list --json id,name,state');
        if (workflows) {
          try {
            return { success: true, _real: true, workflows: JSON.parse(workflows) };
          } catch { /* fall through */ }
        }
      }

      if (action === 'status') {
        const workflowId = input.workflowId as string;
        if (workflowId) {
          const raw = run(`gh run view ${workflowId} --json databaseId,displayTitle,status,conclusion,jobs`);
          if (raw) {
            try { return { success: true, _real: true, run: JSON.parse(raw) }; } catch { /* fall through */ }
          }
        }
        // List recent runs as fallback
        const recent = run('gh run list --limit 5 --json databaseId,displayTitle,status,conclusion');
        if (recent) {
          try { return { success: true, _real: true, recentRuns: JSON.parse(recent) }; } catch { /* fall through */ }
        }
      }

      if (action === 'trigger') {
        const workflowId = input.workflowId as string;
        const ref = (input.ref as string) || 'main';
        if (workflowId) {
          const result = run(`gh workflow run "${workflowId}" --ref "${ref}"`);
          if (result !== null) return { success: true, _real: true, action: 'triggered', workflowId, ref };
        }
        return { success: false, error: 'workflowId is required to trigger a workflow.' };
      }

      if (action === 'cancel') {
        const workflowId = input.workflowId as string;
        if (workflowId) {
          const result = run(`gh run cancel ${workflowId}`);
          if (result !== null) return { success: true, _real: true, action: 'cancelled', runId: workflowId };
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
      const metric = (input.metric as string) || 'all';
      const timeRange = (input.timeRange as string) || '30d';
      const cwd = getProjectCwd();

      // Parse time range
      const days = parseInt(timeRange, 10) || 30;
      const since = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

      const result: Record<string, unknown> = { _real: true, timeRange: `${days}d`, since };

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
            try { result.releases = JSON.parse(raw); } catch { /* skip */ }
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
