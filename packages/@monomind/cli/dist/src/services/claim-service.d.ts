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
import { EventEmitter } from 'node:events';
export type ClaimStatus = 'active' | 'paused' | 'handoff-pending' | 'review-requested' | 'blocked' | 'stealable' | 'completed';
export interface HumanClaimant {
    type: 'human';
    userId: string;
    name: string;
}
export interface AgentClaimant {
    type: 'agent';
    agentId: string;
    agentType: string;
}
export type Claimant = HumanClaimant | AgentClaimant;
export interface Claim {
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
    reason: string;
    stealableAt: Date;
    progress: number;
    context?: string;
    preferredTypes?: string[];
}
export interface ClaimResult {
    success: boolean;
    claim?: Claim;
    error?: string;
}
export interface StealResult {
    success: boolean;
    claim?: Claim;
    previousOwner?: Claimant;
    context?: StealableInfo;
    error?: string;
}
export interface AgentLoad {
    agentId: string;
    agentType: string;
    claimCount: number;
    maxClaims: number;
    utilization: number;
    claims: Claim[];
    avgCompletionTime: number;
    currentBlockedCount: number;
}
export interface RebalanceSuggestion {
    issueId: string;
    currentOwner: Claimant;
    suggestedOwner: Claimant;
    reason: string;
}
export interface RebalanceResult {
    moved: string[];
    suggested: RebalanceSuggestion[];
}
export interface ClaimEvent {
    type: string;
    timestamp: Date;
    issueId: string;
    claimant?: Claimant;
    previousClaimant?: Claimant;
    data?: Record<string, unknown>;
}
export interface ClaimServiceConfig {
    staleThresholdMinutes: number;
    blockedThresholdMinutes: number;
    overloadThreshold: number;
    gracePeriodMinutes: number;
    minProgressToProtect: number;
    contestWindowMinutes: number;
    requireSameType: boolean;
    allowCrossTypeSteal: string[][];
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
    syncLabels: boolean;
    claimLabel: string;
    autoAssign: boolean;
    commentOnClaim: boolean;
    commentOnRelease: boolean;
    repo?: string;
}
export interface SyncResult {
    success: boolean;
    synced: number;
    errors: string[];
    issues?: GitHubIssue[];
}
export declare class ClaimService extends EventEmitter {
    private claims;
    private stealableInfo;
    private storagePath;
    private config;
    private eventLog;
    constructor(projectRoot: string, config?: Partial<ClaimServiceConfig>);
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
    requestReview(issueId: string, reviewers: string[]): Promise<void>;
    markStealable(issueId: string, info: StealableInfo, claimant?: Claimant): Promise<void>;
    steal(issueId: string, stealer: Claimant): Promise<StealResult>;
    getStealable(agentType?: string): Promise<Claim[]>;
    contestSteal(issueId: string, originalClaimant: Claimant, reason: string): Promise<void>;
    getAgentLoad(agentId: string): Promise<AgentLoad>;
    rebalance(_swarmId: string): Promise<RebalanceResult>;
    getClaimedBy(claimant: Claimant): Promise<Claim[]>;
    getAvailableIssues(_filters?: unknown): Promise<GitHubIssue[]>;
    getIssueStatus(issueId: string): Promise<Claim | null>;
    getAllClaims(): Promise<Claim[]>;
    getByStatus(status: ClaimStatus): Promise<Claim[]>;
    expireStale(maxAgeMinutes?: number): Promise<Claim[]>;
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
    syncIssues(state?: 'open' | 'closed' | 'all'): Promise<SyncResult>;
    /**
     * Sync a local claim to GitHub (add label/assignee/comment)
     */
    claimOnGitHub(issueNumber: number, claimant: Claimant): Promise<SyncResult>;
    /**
     * Release claim on GitHub (remove label/assignee/comment)
     */
    releaseOnGitHub(issueNumber: number, claimant: Claimant): Promise<SyncResult>;
    /**
     * Bulk sync all local claims to GitHub
     */
    syncAllClaimsToGitHub(): Promise<SyncResult>;
    /**
     * Get GitHub issues that are claimed locally
     */
    getClaimedGitHubIssues(): Promise<GitHubIssue[]>;
}
export declare function createClaimService(projectRoot: string, config?: Partial<ClaimServiceConfig>): ClaimService;
export declare function createGitHubSync(claimService: ClaimService, config?: Partial<GitHubSyncConfig>): GitHubSync;
export default ClaimService;
//# sourceMappingURL=claim-service.d.ts.map