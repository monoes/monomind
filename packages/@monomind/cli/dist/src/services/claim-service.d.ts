/**
 * V1 Collaborative Issue Claims Service
 *
 * Implements ADR-016: Collaborative Issue Claims for Human-Agent Workflows
 *
 * Features:
 * - Issue claiming/releasing for humans and agents
 * - Handoff mechanisms between humans and agents
 * - Work stealing for idle agents
 * - Load balancing across swarm
 * - GitHub integration
 *
 * @see /packages/implementation/adrs/ADR-016-collaborative-issue-claims.md
 */
import { EventEmitter } from 'events';
export type Claimant = {
    type: 'human';
    userId: string;
    name: string;
} | {
    type: 'agent';
    agentId: string;
    agentType: string;
};
export type ClaimStatus = 'active' | 'paused' | 'handoff-pending' | 'review-requested' | 'blocked' | 'stealable' | 'completed';
export type StealReason = 'overloaded' | 'stale' | 'blocked-timeout' | 'voluntary';
export interface IssueClaim {
    issueId: string;
    claimant: Claimant;
    claimedAt: Date;
    status: ClaimStatus;
    statusChangedAt: Date;
    expiresAt?: Date;
    handoffTo?: Claimant;
    handoffReason?: string;
    blockReason?: string;
    progress: number;
    context?: string;
}
export interface StealableInfo {
    reason: StealReason;
    stealableAt: Date;
    preferredTypes?: string[];
    progress: number;
    context?: string;
}
export interface ClaimResult {
    success: boolean;
    claim?: IssueClaim;
    error?: string;
}
export interface StealResult {
    success: boolean;
    claim?: IssueClaim;
    previousOwner?: Claimant;
    context?: StealableInfo;
    error?: string;
}
export interface AgentLoadInfo {
    agentId: string;
    agentType: string;
    claimCount: number;
    maxClaims: number;
    utilization: number;
    claims: IssueClaim[];
    avgCompletionTime: number;
    currentBlockedCount: number;
}
export interface RebalanceResult {
    moved: Array<{
        issueId: string;
        from: Claimant;
        to: Claimant;
    }>;
    suggested: Array<{
        issueId: string;
        currentOwner: Claimant;
        suggestedOwner: Claimant;
        reason: string;
    }>;
}
export interface WorkStealingConfig {
    staleThresholdMinutes: number;
    blockedThresholdMinutes: number;
    overloadThreshold: number;
    gracePeriodMinutes: number;
    minProgressToProtect: number;
    contestWindowMinutes: number;
    requireSameType: boolean;
    allowCrossTypeSteal: string[][];
}
export interface IssueFilters {
    status?: ClaimStatus[];
    labels?: string[];
    agentTypes?: string[];
    priority?: string[];
}
export interface GitHubIssue {
    number: number;
    title: string;
    body: string;
    state: 'open' | 'closed';
    labels: string[];
    assignees: string[];
    url: string;
    createdAt: Date;
    updatedAt: Date;
}
export interface GitHubSyncConfig {
    enabled: boolean;
    repo?: string;
    syncLabels: boolean;
    claimLabel: string;
    autoAssign: boolean;
    commentOnClaim: boolean;
    commentOnRelease: boolean;
}
export interface GitHubSyncResult {
    success: boolean;
    synced: number;
    errors: string[];
    issues?: GitHubIssue[];
}
export type ClaimEventType = 'issue:claimed' | 'issue:released' | 'issue:handoff:requested' | 'issue:handoff:accepted' | 'issue:handoff:rejected' | 'issue:status:changed' | 'issue:review:requested' | 'issue:expired' | 'issue:stealable' | 'issue:stolen' | 'issue:steal:contested' | 'issue:steal:resolved' | 'swarm:rebalanced' | 'agent:overloaded' | 'agent:underloaded';
export interface ClaimEvent {
    type: ClaimEventType;
    timestamp: Date;
    issueId?: string;
    claimant?: Claimant;
    previousClaimant?: Claimant;
    data?: Record<string, unknown>;
}
export declare class ClaimService extends EventEmitter {
    private claims;
    private stealableInfo;
    private storagePath;
    private config;
    private eventLog;
    constructor(projectRoot: string, config?: Partial<WorkStealingConfig>);
    initialize(): Promise<void>;
    private loadClaims;
    private _saveQueue;
    private saveClaims;
    private _doSaveClaims;
    claim(issueId: string, claimant: Claimant): Promise<ClaimResult>;
    release(issueId: string, claimant: Claimant): Promise<void>;
    requestHandoff(issueId: string, from: Claimant, to: Claimant, reason: string): Promise<void>;
    acceptHandoff(issueId: string, claimant: Claimant): Promise<void>;
    rejectHandoff(issueId: string, claimant: Claimant, reason: string): Promise<void>;
    updateStatus(issueId: string, status: ClaimStatus, note?: string): Promise<void>;
    updateProgress(issueId: string, progress: number): Promise<void>;
    requestReview(issueId: string, reviewers: Claimant[]): Promise<void>;
    markStealable(issueId: string, info: StealableInfo, claimant?: Claimant): Promise<void>;
    steal(issueId: string, stealer: Claimant): Promise<StealResult>;
    getStealable(agentType?: string): Promise<IssueClaim[]>;
    contestSteal(issueId: string, originalClaimant: Claimant, reason: string): Promise<void>;
    getAgentLoad(agentId: string): Promise<AgentLoadInfo>;
    rebalance(swarmId: string): Promise<RebalanceResult>;
    getClaimedBy(claimant: Claimant): Promise<IssueClaim[]>;
    getAvailableIssues(_filters?: IssueFilters): Promise<string[]>;
    getIssueStatus(issueId: string): Promise<IssueClaim | null>;
    getAllClaims(): Promise<IssueClaim[]>;
    getByStatus(status: ClaimStatus): Promise<IssueClaim[]>;
    expireStale(maxAgeMinutes?: number): Promise<IssueClaim[]>;
    private formatClaimant;
    private isSameClaimant;
    private emitEvent;
    getEventLog(limit?: number): ClaimEvent[];
}
export declare class GitHubSync {
    private config;
    private claimService;
    constructor(claimService: ClaimService, config?: Partial<GitHubSyncConfig>);
    /**
     * Check if GitHub CLI is available
     */
    isGhAvailable(): boolean;
    /**
     * Get the current repository from git remote
     */
    getRepo(): string | null;
    /**
     * Sync issues from GitHub
     */
    syncIssues(state?: 'open' | 'closed' | 'all'): Promise<GitHubSyncResult>;
    /**
     * Sync a local claim to GitHub (add label/assignee/comment)
     */
    claimOnGitHub(issueNumber: number, claimant: Claimant): Promise<GitHubSyncResult>;
    /**
     * Release claim on GitHub (remove label/assignee/comment)
     */
    releaseOnGitHub(issueNumber: number, claimant: Claimant): Promise<GitHubSyncResult>;
    /**
     * Bulk sync all local claims to GitHub
     */
    syncAllClaimsToGitHub(): Promise<GitHubSyncResult>;
    /**
     * Get GitHub issues that are claimed locally
     */
    getClaimedGitHubIssues(): Promise<GitHubIssue[]>;
}
export declare function createClaimService(projectRoot: string, config?: Partial<WorkStealingConfig>): ClaimService;
export declare function createGitHubSync(claimService: ClaimService, config?: Partial<GitHubSyncConfig>): GitHubSync;
export default ClaimService;
//# sourceMappingURL=claim-service.d.ts.map