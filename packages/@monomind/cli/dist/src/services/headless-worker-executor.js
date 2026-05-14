/**
 * Headless Worker Executor
 * Enables workers to invoke Claude Code in headless mode with configurable sandbox profiles.
 *
 * ADR-020: Headless Worker Integration Architecture
 * - Integrates with CLAUDE_CODE_HEADLESS and CLAUDE_CODE_SANDBOX_MODE environment variables
 * - Provides process pool for concurrent execution
 * - Builds context from file glob patterns
 * - Supports prompt templates and output parsing
 * - Implements timeout and graceful error handling
 *
 * Key Features:
 * - Process pool with configurable maxConcurrent
 * - Context building from file glob patterns with caching
 * - Prompt template system with context injection
 * - Output parsing (text, json, markdown)
 * - Timeout handling with graceful termination
 * - Execution logging for debugging
 * - Event emission for monitoring
 */
import { spawn, execSync } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, renameSync } from 'fs';
import { join } from 'path';
// ============================================
// Constants
// ============================================
/**
 * Array of headless worker types for runtime checking
 */
export const HEADLESS_WORKER_TYPES = [
    'audit',
    'optimize',
    'testgaps',
    'document',
    'ultralearn',
    'refactor',
    'deepdive',
    'predict',
];
/**
 * Array of local worker types
 */
export const LOCAL_WORKER_TYPES = [
    'map',
    'consolidate',
    'benchmark',
    'preload',
];
/**
 * Model ID mapping
 */
/**
 * Model ID mapping — use short aliases so they auto-resolve to the latest
 * snapshot. Hardcoded dated IDs (e.g. claude-sonnet-4-5-20250929) go stale
 * when Anthropic retires them, causing 100% worker failure (#1431).
 *
 * Users can override per-worker via the `model` field in daemon-state.json
 * or the ANTHROPIC_MODEL environment variable.
 */
const MODEL_IDS = {
    sonnet: 'sonnet',
    opus: 'opus',
    haiku: 'haiku',
};
/**
 * Default headless worker configurations based on ADR-020
 */
export const HEADLESS_WORKER_CONFIGS = {
    audit: {
        type: 'audit',
        mode: 'headless',
        intervalMs: 30 * 60 * 1000,
        priority: 'critical',
        description: 'AI-powered security analysis',
        enabled: true,
        headless: {
            promptTemplate: `Analyze this codebase for security vulnerabilities:
- Check for hardcoded secrets (API keys, passwords)
- Identify SQL injection risks
- Find XSS vulnerabilities
- Check for insecure dependencies
- Identify authentication/authorization issues

Provide a JSON report with:
{
  "vulnerabilities": [{ "severity": "high|medium|low", "file": "...", "line": N, "description": "..." }],
  "riskScore": 0-100,
  "recommendations": ["..."]
}`,
            sandbox: 'strict',
            model: 'haiku',
            outputFormat: 'json',
            contextPatterns: ['**/*.ts', '**/*.js', '**/package.json'],
            timeoutMs: 5 * 60 * 1000,
        },
    },
    optimize: {
        type: 'optimize',
        mode: 'headless',
        intervalMs: 60 * 60 * 1000,
        priority: 'high',
        description: 'AI optimization suggestions',
        enabled: true,
        headless: {
            promptTemplate: `Analyze this codebase for performance optimizations:
- Identify N+1 query patterns
- Find unnecessary re-renders in React
- Suggest caching opportunities
- Identify memory leaks
- Find redundant computations

Provide actionable suggestions with code examples.`,
            sandbox: 'permissive',
            model: 'sonnet',
            outputFormat: 'markdown',
            contextPatterns: ['src/**/*.ts', 'src/**/*.tsx'],
            timeoutMs: 10 * 60 * 1000,
        },
    },
    testgaps: {
        type: 'testgaps',
        mode: 'headless',
        intervalMs: 60 * 60 * 1000,
        priority: 'normal',
        description: 'AI test gap analysis',
        enabled: true,
        headless: {
            promptTemplate: `Analyze test coverage and identify gaps:
- Find untested functions and classes
- Identify edge cases not covered
- Suggest new test scenarios
- Check for missing error handling tests
- Identify integration test gaps

For each gap, provide a test skeleton.`,
            sandbox: 'permissive',
            model: 'sonnet',
            outputFormat: 'markdown',
            contextPatterns: ['src/**/*.ts', 'tests/**/*.ts', '__tests__/**/*.ts'],
            timeoutMs: 10 * 60 * 1000,
        },
    },
    document: {
        type: 'document',
        mode: 'headless',
        intervalMs: 120 * 60 * 1000,
        priority: 'low',
        description: 'AI documentation generation',
        enabled: false,
        headless: {
            promptTemplate: `Generate documentation for undocumented code:
- Add JSDoc comments to functions
- Create README sections for modules
- Document API endpoints
- Add inline comments for complex logic
- Generate usage examples

Focus on public APIs and exported functions.`,
            sandbox: 'permissive',
            model: 'haiku',
            outputFormat: 'markdown',
            contextPatterns: ['src/**/*.ts'],
            timeoutMs: 10 * 60 * 1000,
        },
    },
    ultralearn: {
        type: 'ultralearn',
        mode: 'headless',
        intervalMs: 0, // Manual trigger only
        priority: 'normal',
        description: 'Deep knowledge acquisition',
        enabled: false,
        headless: {
            promptTemplate: `Deeply analyze this codebase to learn:
- Architectural patterns used
- Coding conventions
- Domain-specific terminology
- Common patterns and idioms
- Team preferences

Provide insights as JSON:
{
  "architecture": { "patterns": [...], "style": "..." },
  "conventions": { "naming": "...", "formatting": "..." },
  "domains": ["..."],
  "insights": ["..."]
}`,
            sandbox: 'strict',
            model: 'opus',
            outputFormat: 'json',
            contextPatterns: ['**/*.ts', '**/CLAUDE.md', '**/README.md'],
            timeoutMs: 15 * 60 * 1000,
        },
    },
    refactor: {
        type: 'refactor',
        mode: 'headless',
        intervalMs: 0, // Manual trigger only
        priority: 'normal',
        description: 'AI refactoring suggestions',
        enabled: false,
        headless: {
            promptTemplate: `Suggest refactoring opportunities:
- Identify code duplication
- Suggest better abstractions
- Find opportunities for design patterns
- Identify overly complex functions
- Suggest module reorganization

Provide before/after code examples.`,
            sandbox: 'permissive',
            model: 'sonnet',
            outputFormat: 'markdown',
            contextPatterns: ['src/**/*.ts'],
            timeoutMs: 10 * 60 * 1000,
        },
    },
    deepdive: {
        type: 'deepdive',
        mode: 'headless',
        intervalMs: 0, // Manual trigger only
        priority: 'normal',
        description: 'Deep code analysis',
        enabled: false,
        headless: {
            promptTemplate: `Perform deep analysis of this codebase:
- Understand data flow
- Map dependencies
- Identify architectural issues
- Find potential bugs
- Analyze error handling

Provide comprehensive report.`,
            sandbox: 'strict',
            model: 'opus',
            outputFormat: 'markdown',
            contextPatterns: ['src/**/*.ts'],
            timeoutMs: 15 * 60 * 1000,
        },
    },
    predict: {
        type: 'predict',
        mode: 'headless',
        intervalMs: 10 * 60 * 1000,
        priority: 'low',
        description: 'Predictive preloading',
        enabled: false,
        headless: {
            promptTemplate: `Based on recent activity, predict what the developer needs:
- Files likely to be edited next
- Tests that should be run
- Documentation to reference
- Dependencies to check

Provide preload suggestions as JSON:
{
  "filesToPreload": ["..."],
  "testsToRun": ["..."],
  "docsToReference": ["..."],
  "confidence": 0.0-1.0
}`,
            sandbox: 'strict',
            model: 'haiku',
            outputFormat: 'json',
            contextPatterns: ['.monomind/metrics/*.json'],
            timeoutMs: 2 * 60 * 1000,
        },
    },
};
/**
 * Local worker configurations
 */
export const LOCAL_WORKER_CONFIGS = {
    map: {
        type: 'map',
        mode: 'local',
        intervalMs: 15 * 60 * 1000,
        priority: 'normal',
        description: 'Codebase mapping',
        enabled: true,
    },
    consolidate: {
        type: 'consolidate',
        mode: 'local',
        intervalMs: 30 * 60 * 1000,
        priority: 'low',
        description: 'Memory consolidation',
        enabled: true,
    },
    benchmark: {
        type: 'benchmark',
        mode: 'local',
        intervalMs: 60 * 60 * 1000,
        priority: 'low',
        description: 'Performance benchmarking',
        enabled: false,
    },
    preload: {
        type: 'preload',
        mode: 'local',
        intervalMs: 5 * 60 * 1000,
        priority: 'low',
        description: 'Resource preloading',
        enabled: false,
    },
};
/**
 * Combined worker configurations
 */
export const ALL_WORKER_CONFIGS = [
    ...Object.values(HEADLESS_WORKER_CONFIGS),
    ...Object.values(LOCAL_WORKER_CONFIGS),
];
// ============================================
// Utility Functions
// ============================================
/**
 * Check if a worker type is a headless worker
 */
export function isHeadlessWorker(type) {
    return HEADLESS_WORKER_TYPES.includes(type);
}
/**
 * Check if a worker type is a local worker
 */
export function isLocalWorker(type) {
    return LOCAL_WORKER_TYPES.includes(type);
}
/**
 * Get model ID from model type
 */
export function getModelId(model) {
    return MODEL_IDS[model];
}
/**
 * Get worker configuration by type
 */
export function getWorkerConfig(type) {
    if (isHeadlessWorker(type)) {
        return HEADLESS_WORKER_CONFIGS[type];
    }
    if (isLocalWorker(type)) {
        return LOCAL_WORKER_CONFIGS[type];
    }
    return undefined;
}
// ============================================
// HeadlessWorkerExecutor Class
// ============================================
/**
 * HeadlessWorkerExecutor - Executes workers using Claude Code in headless mode
 *
 * Features:
 * - Process pool with configurable concurrency limit
 * - Pending queue for overflow requests
 * - Context caching with configurable TTL
 * - Execution logging for debugging
 * - Event emission for monitoring
 * - Graceful termination
 */
export class HeadlessWorkerExecutor extends EventEmitter {
    projectRoot;
    config;
    processPool = new Map();
    pendingQueue = [];
    contextCache = new Map();
    claudeCodeAvailable = null;
    claudeCodeAvailableCheckedAt = null;
    claudeCodeVersion = null;
    // SECURITY: synchronous reservation counter so processQueue() does not
    // drain the entire pendingQueue before async pool insertions catch up.
    // Without this, a single processQueue() iteration could spawn hundreds of
    // claude child processes simultaneously (DoS amplifier: 1 dequeue → 500 spawns).
    activeReservations = 0;
    constructor(projectRoot, options) {
        super();
        this.projectRoot = projectRoot;
        // Merge with defaults
        this.config = {
            maxConcurrent: options?.maxConcurrent ?? 2,
            defaultTimeoutMs: options?.defaultTimeoutMs ?? 5 * 60 * 1000,
            maxContextFiles: options?.maxContextFiles ?? 20,
            maxCharsPerFile: options?.maxCharsPerFile ?? 5000,
            logDir: options?.logDir ?? join(projectRoot, '.monomind', 'logs', 'headless'),
            cacheContext: options?.cacheContext ?? true,
            cacheTtlMs: options?.cacheTtlMs ?? 60000, // 1 minute default
        };
        // Ensure log directory exists
        this.ensureLogDir();
    }
    // ============================================
    // Public API
    // ============================================
    /**
     * Check if Claude Code CLI is available
     */
    async isAvailable() {
        const NEGATIVE_CACHE_TTL_MS = 60_000; // re-check after 1 min on negative result
        if (this.claudeCodeAvailable === true) {
            return true;
        }
        if (this.claudeCodeAvailable === false && this.claudeCodeAvailableCheckedAt !== null) {
            if (Date.now() - this.claudeCodeAvailableCheckedAt < NEGATIVE_CACHE_TTL_MS) {
                return false;
            }
        }
        try {
            const output = execSync('claude --version', {
                encoding: 'utf-8',
                stdio: 'pipe',
                timeout: 5000,
                windowsHide: true, // Prevent phantom console windows on Windows
            });
            this.claudeCodeAvailable = true;
            this.claudeCodeAvailableCheckedAt = Date.now();
            this.claudeCodeVersion = output.trim();
            this.emit('status', { available: true, version: this.claudeCodeVersion });
            return true;
        }
        catch {
            this.claudeCodeAvailable = false;
            this.claudeCodeAvailableCheckedAt = Date.now();
            this.emit('status', { available: false });
            return false;
        }
    }
    /**
     * Get Claude Code version
     */
    async getVersion() {
        await this.isAvailable();
        return this.claudeCodeVersion;
    }
    /**
     * Execute a headless worker
     */
    async execute(workerType, configOverrides) {
        const baseConfig = HEADLESS_WORKER_CONFIGS[workerType];
        if (!baseConfig) {
            throw new Error(`Unknown headless worker type: ${workerType}`);
        }
        // Check availability
        const available = await this.isAvailable();
        if (!available) {
            const result = this.createErrorResult(workerType, 'Claude Code CLI not available. Install with: npm install -g @anthropic-ai/claude-code');
            this.emit('error', result);
            return result;
        }
        // Check concurrent limit using activeReservations (synchronous counter)
        // rather than processPool.size (which is updated only after async setup).
        if (this.activeReservations >= this.config.maxConcurrent) {
            // Queue the request
            const MAX_PENDING = 500;
            if (this.pendingQueue.length >= MAX_PENDING) {
                return this.createErrorResult(workerType, 'Pending queue is full');
            }
            return new Promise((resolve, reject) => {
                const entry = {
                    workerType,
                    config: configOverrides,
                    resolve,
                    reject,
                    queuedAt: new Date(),
                };
                this.pendingQueue.push(entry);
                this.emit('queued', {
                    workerType,
                    queuePosition: this.pendingQueue.length,
                });
            });
        }
        // Reserve the slot synchronously and release it (regardless of success
        // or failure) so processQueue can pull the next pending item.
        this.activeReservations++;
        try {
            return await this.executeInternal(workerType, configOverrides);
        }
        finally {
            this.activeReservations--;
            this.processQueue();
        }
    }
    /**
     * Get pool status
     */
    getPoolStatus() {
        const now = Date.now();
        return {
            activeCount: this.processPool.size,
            queueLength: this.pendingQueue.length,
            maxConcurrent: this.config.maxConcurrent,
            activeWorkers: Array.from(this.processPool.values()).map((entry) => ({
                executionId: entry.executionId,
                workerType: entry.workerType,
                startTime: entry.startTime,
                elapsedMs: now - entry.startTime.getTime(),
            })),
            queuedWorkers: this.pendingQueue.map((entry) => ({
                workerType: entry.workerType,
                queuedAt: entry.queuedAt,
                waitingMs: now - entry.queuedAt.getTime(),
            })),
        };
    }
    /**
     * Get number of active executions
     */
    getActiveCount() {
        return this.processPool.size;
    }
    /**
     * Cancel a running execution
     */
    cancel(executionId) {
        const entry = this.processPool.get(executionId);
        if (!entry) {
            return false;
        }
        clearTimeout(entry.timeout);
        let exited = false;
        entry.process.once('exit', () => { exited = true; });
        try {
            entry.process.kill('SIGTERM');
        }
        catch { /* may already be dead */ }
        const killTimer = setTimeout(() => {
            if (!exited) {
                try {
                    entry.process.kill('SIGKILL');
                }
                catch { /* ignore */ }
            }
        }, 5000);
        killTimer.unref();
        entry.process.once('exit', () => clearTimeout(killTimer));
        this.processPool.delete(executionId);
        this.emit('cancelled', { executionId });
        // Process next in queue
        this.processQueue();
        return true;
    }
    /**
     * Cancel all running executions for a specific worker type.
     * Used by the timeout handler in worker-daemon to avoid killing unrelated workers.
     */
    cancelByType(workerType) {
        let cancelled = false;
        const entries = Array.from(this.processPool.entries());
        for (const [executionId, entry] of entries) {
            if (entry.workerType !== workerType)
                continue;
            clearTimeout(entry.timeout);
            let exited = false;
            entry.process.once('exit', () => { exited = true; });
            try {
                entry.process.kill('SIGTERM');
            }
            catch { /* may already be dead */ }
            const killTimer = setTimeout(() => {
                if (!exited) {
                    try {
                        entry.process.kill('SIGKILL');
                    }
                    catch { /* ignore */ }
                }
            }, 5000);
            killTimer.unref();
            entry.process.once('exit', () => clearTimeout(killTimer));
            this.processPool.delete(executionId);
            this.emit('cancelled', { executionId });
            cancelled = true;
        }
        if (cancelled)
            this.processQueue();
        return cancelled;
    }
    /**
     * Cancel all running executions
     */
    cancelAll() {
        let cancelled = 0;
        // Cancel active processes (convert to array to avoid iterator issues)
        const entries = Array.from(this.processPool.entries());
        for (const [executionId, entry] of entries) {
            clearTimeout(entry.timeout);
            // Track exit so the SIGKILL fallback can't be sent to a recycled PID.
            // entry.process.killed is set by Node when .kill() was called, NOT when
            // the OS process actually exited — without an explicit 'exit' listener,
            // a recycled PID can receive our SIGKILL.
            let exited = false;
            entry.process.once('exit', () => { exited = true; });
            try {
                entry.process.kill('SIGTERM');
            }
            catch { /* may already be dead */ }
            const killTimer = setTimeout(() => {
                if (exited)
                    return;
                try {
                    entry.process.kill('SIGKILL');
                }
                catch { /* already dead */ }
            }, 5000);
            killTimer.unref();
            entry.process.once('exit', () => clearTimeout(killTimer));
            this.emit('cancelled', { executionId });
            cancelled++;
        }
        this.processPool.clear();
        // Reject pending queue
        for (const entry of this.pendingQueue) {
            entry.reject(new Error('Executor cancelled all executions'));
        }
        this.pendingQueue = [];
        this.emit('allCancelled', { count: cancelled });
        return cancelled;
    }
    /**
     * Clear context cache
     */
    clearContextCache() {
        this.contextCache.clear();
        this.emit('cacheClear', {});
    }
    /**
     * Get worker configuration
     */
    getConfig(workerType) {
        return HEADLESS_WORKER_CONFIGS[workerType];
    }
    /**
     * Get all headless worker types
     */
    getHeadlessWorkerTypes() {
        return [...HEADLESS_WORKER_TYPES];
    }
    /**
     * Get all local worker types
     */
    getLocalWorkerTypes() {
        return [...LOCAL_WORKER_TYPES];
    }
    // ============================================
    // Private Methods
    // ============================================
    /**
     * Ensure log directory exists
     */
    ensureLogDir() {
        try {
            if (!existsSync(this.config.logDir)) {
                mkdirSync(this.config.logDir, { recursive: true });
            }
        }
        catch (error) {
            this.emit('warning', { message: 'Failed to create log directory', error });
        }
    }
    /**
     * Internal execution logic
     */
    async executeInternal(workerType, configOverrides) {
        const baseConfig = HEADLESS_WORKER_CONFIGS[workerType];
        const headless = { ...baseConfig.headless, ...configOverrides };
        const startTime = Date.now();
        const executionId = `${workerType}_${startTime}_${Math.random().toString(36).slice(2, 8)}`;
        this.emit('start', { executionId, workerType, config: headless });
        try {
            // Build context from file patterns
            const context = await this.buildContext(headless.contextPatterns || []);
            // Build the full prompt
            const fullPrompt = this.buildPrompt(headless.promptTemplate, context);
            // Log prompt for debugging
            this.logExecution(executionId, 'prompt', fullPrompt);
            // Execute Claude Code headlessly
            const result = await this.executeClaudeCode(fullPrompt, {
                sandbox: headless.sandbox,
                model: headless.model || 'sonnet',
                timeoutMs: headless.timeoutMs || this.config.defaultTimeoutMs,
                executionId,
                workerType,
            });
            // Parse output based on format
            let parsedOutput;
            if (headless.outputFormat === 'json' && result.output) {
                parsedOutput = this.parseJsonOutput(result.output);
            }
            else if (headless.outputFormat === 'markdown' && result.output) {
                parsedOutput = this.parseMarkdownOutput(result.output);
            }
            const executionResult = {
                success: result.success,
                output: result.output,
                parsedOutput,
                durationMs: Date.now() - startTime,
                tokensUsed: result.tokensUsed,
                model: headless.model || 'sonnet',
                sandboxMode: headless.sandbox,
                workerType,
                timestamp: new Date(),
                executionId,
                error: result.error,
            };
            // Log result
            this.logExecution(executionId, 'result', JSON.stringify(executionResult, null, 2));
            this.emit('complete', executionResult);
            return executionResult;
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const executionResult = this.createErrorResult(workerType, errorMessage);
            executionResult.executionId = executionId;
            executionResult.durationMs = Date.now() - startTime;
            this.logExecution(executionId, 'error', errorMessage);
            this.emit('error', executionResult);
            return executionResult;
        }
        finally {
            // Process next in queue
            this.processQueue();
        }
    }
    /**
     * Process the pending queue
     */
    processQueue() {
        // Gate on activeReservations (synchronous counter) so we cannot
        // accidentally drain the queue past maxConcurrent before async setup
        // populates processPool.
        while (this.pendingQueue.length > 0 &&
            this.activeReservations < this.config.maxConcurrent) {
            const next = this.pendingQueue.shift();
            if (!next)
                break;
            this.activeReservations++;
            this.executeInternal(next.workerType, next.config)
                .then(next.resolve, next.reject)
                .finally(() => {
                this.activeReservations--;
                this.processQueue();
            });
        }
    }
    /**
     * Build context from file patterns
     */
    async buildContext(patterns) {
        if (patterns.length === 0)
            return '';
        // Check cache
        const cacheKey = patterns.sort().join('|');
        if (this.config.cacheContext) {
            const cached = this.contextCache.get(cacheKey);
            if (cached && Date.now() - cached.timestamp < this.config.cacheTtlMs) {
                return cached.content;
            }
        }
        // Collect files matching patterns
        const files = [];
        for (const pattern of patterns) {
            const matches = this.simpleGlob(pattern);
            files.push(...matches);
        }
        // Deduplicate and limit
        const uniqueFiles = Array.from(new Set(files)).slice(0, this.config.maxContextFiles);
        // Build context
        const { resolve: resolvePath, sep } = await import('path');
        const contextParts = [];
        for (const file of uniqueFiles) {
            try {
                const fullPath = join(this.projectRoot, file);
                const resolvedFull = resolvePath(fullPath);
                const resolvedRoot = resolvePath(this.projectRoot);
                if (!resolvedFull.startsWith(resolvedRoot + sep) && resolvedFull !== resolvedRoot)
                    continue;
                if (!existsSync(resolvedFull))
                    continue;
                const content = readFileSync(resolvedFull, 'utf-8');
                const truncated = content.slice(0, this.config.maxCharsPerFile);
                const wasTruncated = content.length > this.config.maxCharsPerFile;
                contextParts.push(`--- ${file}${wasTruncated ? ' (truncated)' : ''} ---\n${truncated}`);
            }
            catch {
                // Skip unreadable files
            }
        }
        const contextContent = contextParts.join('\n\n');
        // Cache the result (evict oldest when at capacity)
        if (this.config.cacheContext) {
            if (this.contextCache.size >= 50) {
                const oldestKey = this.contextCache.keys().next().value;
                if (oldestKey !== undefined)
                    this.contextCache.delete(oldestKey);
            }
            this.contextCache.set(cacheKey, {
                content: contextContent,
                timestamp: Date.now(),
                patterns,
            });
        }
        return contextContent;
    }
    /**
     * Simple glob implementation for file matching
     */
    simpleGlob(pattern) {
        const results = [];
        // Handle simple patterns (no wildcards)
        if (!pattern.includes('*')) {
            const fullPath = join(this.projectRoot, pattern);
            if (existsSync(fullPath)) {
                results.push(pattern);
            }
            return results;
        }
        // Parse pattern parts
        const parts = pattern.split('/');
        const scanDir = (dir, remainingParts) => {
            if (remainingParts.length === 0)
                return;
            if (results.length >= 100)
                return; // Limit results
            try {
                const fullDir = join(this.projectRoot, dir);
                if (!existsSync(fullDir))
                    return;
                const entries = readdirSync(fullDir, { withFileTypes: true });
                const currentPart = remainingParts[0];
                const isLastPart = remainingParts.length === 1;
                for (const entry of entries) {
                    // Skip common non-code directories
                    if (entry.name === 'node_modules' ||
                        entry.name === '.git' ||
                        entry.name === 'dist' ||
                        entry.name === 'build' ||
                        entry.name === 'coverage' ||
                        entry.name === '.next' ||
                        entry.name === '.cache') {
                        continue;
                    }
                    const entryPath = dir ? `${dir}/${entry.name}` : entry.name;
                    if (currentPart === '**') {
                        // Recursive glob
                        if (entry.isDirectory()) {
                            scanDir(entryPath, remainingParts); // Continue with **
                            scanDir(entryPath, remainingParts.slice(1)); // Try next part
                        }
                        else if (entry.isFile() && remainingParts.length > 1) {
                            // Check if file matches next pattern part
                            const nextPart = remainingParts[1];
                            if (this.matchesPattern(entry.name, nextPart)) {
                                results.push(entryPath);
                            }
                        }
                    }
                    else if (this.matchesPattern(entry.name, currentPart)) {
                        if (isLastPart && entry.isFile()) {
                            results.push(entryPath);
                        }
                        else if (!isLastPart && entry.isDirectory()) {
                            scanDir(entryPath, remainingParts.slice(1));
                        }
                    }
                }
            }
            catch {
                // Skip unreadable directories
            }
        };
        scanDir('', parts);
        return results;
    }
    /**
     * Match filename against a simple pattern
     */
    matchesPattern(name, pattern) {
        if (pattern === '*')
            return true;
        if (pattern === '**')
            return true;
        // Handle *.ext patterns
        if (pattern.startsWith('*.')) {
            return name.endsWith(pattern.slice(1));
        }
        // Handle prefix* patterns
        if (pattern.endsWith('*')) {
            return name.startsWith(pattern.slice(0, -1));
        }
        // Handle *suffix patterns
        if (pattern.startsWith('*')) {
            return name.endsWith(pattern.slice(1));
        }
        // Exact match
        return name === pattern;
    }
    /**
     * Build full prompt with context
     */
    buildPrompt(template, context) {
        if (!context) {
            return `${template}

## Instructions

Analyze the codebase and provide your response following the format specified in the task.`;
        }
        return `${template}

## Codebase Context

${context}

## Instructions

Analyze the above codebase context and provide your response following the format specified in the task.`;
    }
    /**
     * Execute Claude Code in headless mode
     */
    executeClaudeCode(prompt, options) {
        return new Promise((resolve) => {
            // SECURITY: in strict sandbox mode, build a minimal env allowlist instead
            // of forwarding the entire parent env. The previous spread also passed
            // LD_PRELOAD, NODE_OPTIONS, DYLD_INSERT_LIBRARIES, PYTHONPATH, HTTP_PROXY,
            // etc. — which means "strict" was a label, not a control. Now it actually
            // strips dangerous loaders/proxies even when the parent has them set.
            const STRICT_ENV_ALLOWLIST = new Set([
                'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'TERM', 'SHELL',
                'TMPDIR', 'TMP', 'TEMP',
                'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL',
            ]);
            const FORBIDDEN_ENV = new Set([
                'LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT',
                'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH', 'DYLD_FALLBACK_LIBRARY_PATH',
                'NODE_OPTIONS', 'NODE_PATH',
                'PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP',
                'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
                'BASH_ENV', 'ENV', 'CDPATH',
                'PERL5OPT', 'RUBYOPT',
                'JAVA_TOOL_OPTIONS', '_JAVA_OPTIONS', 'JDK_JAVA_OPTIONS',
            ]);
            const baseEnv = {};
            if (options.sandbox === 'strict') {
                for (const k of STRICT_ENV_ALLOWLIST) {
                    const v = process.env[k];
                    if (typeof v === 'string')
                        baseEnv[k] = v;
                }
            }
            else {
                for (const [k, v] of Object.entries(process.env)) {
                    if (typeof v !== 'string')
                        continue;
                    if (FORBIDDEN_ENV.has(k))
                        continue; // always strip in any mode
                    baseEnv[k] = v;
                }
            }
            const env = {
                ...baseEnv,
                CLAUDE_CODE_HEADLESS: 'true',
                CLAUDE_CODE_SANDBOX_MODE: options.sandbox,
                // Fix #1395 Bug 2: Workers fail inside active Claude Code session.
                // Claude Code detects nested sessions and exits immediately.
                // Setting CLAUDE_ENTRYPOINT=worker bypasses the nested-session check,
                // and unsetting CLAUDE_SESSION_ID prevents parent session detection.
                CLAUDE_ENTRYPOINT: 'worker',
            };
            // Remove parent session markers so the child doesn't detect a "nested" session
            delete env.CLAUDE_SESSION_ID;
            delete env.CLAUDE_PARENT_SESSION_ID;
            // Set model
            // Resolve model: user env override > config override > default alias
            env.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || MODEL_IDS[options.model];
            // Spawn claude CLI process — `--` terminates option parsing so prompt can't smuggle flags
            const child = spawn('claude', ['--print', '--', prompt], {
                cwd: this.projectRoot,
                env,
                stdio: ['ignore', 'pipe', 'pipe'], // 'ignore' closes stdin at spawn — fixes #1395 where claude --print blocks on EOF
                windowsHide: true, // Prevent phantom console windows on Windows
            });
            // Setup timeout — track real exit via 'exit' listener.
            // child.killed is set by Node when .kill() is called (signal sent), NOT
            // when the OS process exited. Without an explicit `exited` flag the
            // SIGKILL fallback never fires for a process that ignores SIGTERM, and
            // the slot leaks indefinitely.
            let sigkillTimer;
            let childExited = false;
            child.once('exit', () => { childExited = true; });
            const timeoutHandle = setTimeout(() => {
                if (this.processPool.has(options.executionId)) {
                    try {
                        child.kill('SIGTERM');
                    }
                    catch { /* may already be dead */ }
                    sigkillTimer = setTimeout(() => {
                        if (childExited)
                            return;
                        try {
                            child.kill('SIGKILL');
                        }
                        catch { /* already dead */ }
                    }, 5000);
                    sigkillTimer.unref();
                }
            }, options.timeoutMs);
            // Track in process pool
            const poolEntry = {
                process: child,
                executionId: options.executionId,
                workerType: options.workerType,
                startTime: new Date(),
                timeout: timeoutHandle,
            };
            this.processPool.set(options.executionId, poolEntry);
            let stdout = '';
            let stderr = '';
            let resolved = false;
            const cleanup = () => {
                clearTimeout(timeoutHandle);
                clearTimeout(sigkillTimer);
                this.processPool.delete(options.executionId);
            };
            child.stdout?.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                this.emit('output', {
                    executionId: options.executionId,
                    type: 'stdout',
                    data: chunk,
                });
            });
            child.stderr?.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                this.emit('output', {
                    executionId: options.executionId,
                    type: 'stderr',
                    data: chunk,
                });
            });
            child.on('close', (code) => {
                if (resolved)
                    return;
                resolved = true;
                cleanup();
                resolve({
                    success: code === 0,
                    output: stdout || stderr,
                    error: code !== 0 ? stderr || `Process exited with code ${code}` : undefined,
                });
            });
            child.on('error', (error) => {
                if (resolved)
                    return;
                resolved = true;
                cleanup();
                resolve({
                    success: false,
                    output: '',
                    error: error.message,
                });
            });
        });
    }
    /**
     * Parse JSON output from Claude Code
     */
    parseJsonOutput(output) {
        try {
            // Try to find JSON in code blocks first
            const codeBlockMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
                return JSON.parse(codeBlockMatch[1].trim());
            }
            // Try to find any JSON object
            const jsonMatch = output.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
            // Try direct parse
            return JSON.parse(output.trim());
        }
        catch {
            return {
                parseError: true,
                rawOutput: output,
            };
        }
    }
    /**
     * Parse markdown output into sections
     */
    parseMarkdownOutput(output) {
        const sections = [];
        const codeBlocks = [];
        // Extract code blocks first
        const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
        let codeMatch;
        while ((codeMatch = codeBlockRegex.exec(output)) !== null) {
            codeBlocks.push({
                language: codeMatch[1] || 'text',
                code: codeMatch[2].trim(),
            });
        }
        // Parse sections
        const lines = output.split('\n');
        let currentSection = null;
        for (const line of lines) {
            const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headerMatch) {
                if (currentSection) {
                    sections.push(currentSection);
                }
                currentSection = {
                    title: headerMatch[2].trim(),
                    content: '',
                    level: headerMatch[1].length,
                };
            }
            else if (currentSection) {
                currentSection.content += line + '\n';
            }
        }
        if (currentSection) {
            currentSection.content = currentSection.content.trim();
            sections.push(currentSection);
        }
        return { sections, codeBlocks };
    }
    /**
     * Create an error result
     */
    createErrorResult(workerType, error) {
        return {
            success: false,
            output: '',
            durationMs: 0,
            model: 'unknown',
            sandboxMode: 'strict',
            workerType,
            timestamp: new Date(),
            executionId: `error_${Date.now()}`,
            error,
        };
    }
    /**
     * Log execution details for debugging
     */
    logExecution(executionId, type, content) {
        try {
            const timestamp = new Date().toISOString();
            const logFile = join(this.config.logDir, `${executionId}_${type}.log`);
            const logContent = `[${timestamp}] ${type.toUpperCase()}\n${'='.repeat(60)}\n${content}\n`;
            const tmpLog = logFile + '.tmp';
            writeFileSync(tmpLog, logContent);
            renameSync(tmpLog, logFile);
        }
        catch {
            // Ignore log write errors
        }
    }
}
// Export default
export default HeadlessWorkerExecutor;
//# sourceMappingURL=headless-worker-executor.js.map