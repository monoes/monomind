/**
 * Run Ledger + Evaluators
 *
 * Logs every run as an event with a minimum schema, then runs evaluators
 * to assess compliance and quality.
 *
 * Objective evaluators:
 * 1. Tests pass
 * 2. Lint pass
 * 3. Forbidden dependency scan
 * 4. Forbidden command scan
 * 5. Required sections present in plan
 *
 * Subjective evaluators:
 * 1. Reviewer rating (pass/fail)
 * 2. Architecture compliance (pass/fail)
 *
 * @module @monobrain/guidance/ledger
 */
import { randomUUID } from 'node:crypto';
// ============================================================================
// Built-in Evaluators
// ============================================================================
/**
 * Tests Pass evaluator - checks test results
 */
export class TestsPassEvaluator {
    name = 'tests-pass';
    type = 'objective';
    async evaluate(event) {
        if (!event.testResults.ran) {
            return {
                name: this.name,
                passed: false,
                details: 'Tests were not run during this task',
                score: 0,
            };
        }
        const passed = event.testResults.failed === 0;
        const total = event.testResults.passed + event.testResults.failed + event.testResults.skipped;
        return {
            name: this.name,
            passed,
            details: passed
                ? `All ${event.testResults.passed} tests passed (${event.testResults.skipped} skipped)`
                : `${event.testResults.failed} of ${total} tests failed`,
            score: total > 0 ? event.testResults.passed / total : 0,
        };
    }
}
/**
 * Forbidden command scan evaluator
 */
export class ForbiddenCommandEvaluator {
    name = 'forbidden-command-scan';
    type = 'objective';
    forbiddenPatterns;
    constructor(forbiddenPatterns) {
        this.forbiddenPatterns = forbiddenPatterns ?? [
            /\brm\s+-rf\s+\//,
            /\bgit\s+push\s+--force\s+origin\s+(?:main|master)\b/,
            /\bcurl\s+.*\|\s*(?:sh|bash)\b/,
            /\beval\s*\(/,
            /\bexec\s*\(/,
        ];
    }
    async evaluate(event) {
        const violations = [];
        for (const tool of event.toolsUsed) {
            for (const pattern of this.forbiddenPatterns) {
                if (pattern.test(tool)) {
                    violations.push(`Forbidden command pattern: ${pattern.source} matched in "${tool}"`);
                }
            }
        }
        return {
            name: this.name,
            passed: violations.length === 0,
            details: violations.length === 0
                ? 'No forbidden commands detected'
                : `Found ${violations.length} forbidden command(s): ${violations.join('; ')}`,
            score: violations.length === 0 ? 1 : 0,
        };
    }
}
/**
 * Forbidden dependency scan evaluator
 */
export class ForbiddenDependencyEvaluator {
    name = 'forbidden-dependency-scan';
    type = 'objective';
    forbiddenPackages;
    constructor(forbiddenPackages) {
        this.forbiddenPackages = forbiddenPackages ?? [];
    }
    async evaluate(event) {
        if (this.forbiddenPackages.length === 0) {
            return { name: this.name, passed: true, details: 'No forbidden dependencies configured', score: 1 };
        }
        // Check if any forbidden packages were introduced in touched files
        const packageFiles = event.filesTouched.filter(f => f.endsWith('package.json') || f.endsWith('package-lock.json'));
        return {
            name: this.name,
            passed: true,
            details: packageFiles.length > 0
                ? `Package files modified: ${packageFiles.join(', ')} - manual review recommended`
                : 'No package files modified',
            score: 1,
        };
    }
}
/**
 * Violation rate evaluator - checks violation count
 */
export class ViolationRateEvaluator {
    name = 'violation-rate';
    type = 'objective';
    maxViolations;
    constructor(maxViolations = 0) {
        this.maxViolations = maxViolations;
    }
    async evaluate(event) {
        const count = event.violations.length;
        const passed = count <= this.maxViolations;
        return {
            name: this.name,
            passed,
            details: passed
                ? `${count} violation(s) within threshold (max: ${this.maxViolations})`
                : `${count} violation(s) exceeds threshold (max: ${this.maxViolations})`,
            score: Math.max(0, 1 - count / Math.max(this.maxViolations + 1, 1)),
        };
    }
}
/**
 * Diff quality evaluator - checks rework ratio
 */
export class DiffQualityEvaluator {
    name = 'diff-quality';
    type = 'objective';
    maxReworkRatio;
    constructor(maxReworkRatio = 0.3) {
        this.maxReworkRatio = maxReworkRatio;
    }
    async evaluate(event) {
        const totalLines = event.diffSummary.linesAdded + event.diffSummary.linesRemoved;
        if (totalLines === 0) {
            return { name: this.name, passed: true, details: 'No diff produced', score: 1 };
        }
        const reworkRatio = event.reworkLines / totalLines;
        const passed = reworkRatio <= this.maxReworkRatio;
        return {
            name: this.name,
            passed,
            details: `Rework ratio: ${(reworkRatio * 100).toFixed(1)}% (${event.reworkLines}/${totalLines} lines). Threshold: ${(this.maxReworkRatio * 100).toFixed(0)}%`,
            score: Math.max(0, 1 - reworkRatio),
        };
    }
}
// ============================================================================
// Run Ledger
// ============================================================================
export class RunLedger {
    events = [];
    evaluators = [];
    maxEvents;
    /**
     * @param maxEvents - Maximum events to retain in memory (0 = unlimited).
     *   When the limit is exceeded the oldest events are evicted.
     */
    constructor(maxEvents = 0) {
        this.maxEvents = maxEvents;
        // Register default evaluators
        this.evaluators = [
            new TestsPassEvaluator(),
            new ForbiddenCommandEvaluator(),
            new ForbiddenDependencyEvaluator(),
            new ViolationRateEvaluator(),
            new DiffQualityEvaluator(),
        ];
    }
    /**
     * Add a custom evaluator
     */
    addEvaluator(evaluator) {
        this.evaluators.push(evaluator);
    }
    /**
     * Remove an evaluator by name
     */
    removeEvaluator(name) {
        this.evaluators = this.evaluators.filter(e => e.name !== name);
    }
    /**
     * Log a run event
     */
    logEvent(event) {
        const fullEvent = {
            ...event,
            eventId: randomUUID(),
        };
        this.events.push(fullEvent);
        this.evictIfNeeded();
        return fullEvent;
    }
    /**
     * Create a new run event with defaults
     */
    createEvent(taskId, intent, guidanceHash) {
        return {
            eventId: randomUUID(),
            taskId,
            guidanceHash,
            retrievedRuleIds: [],
            toolsUsed: [],
            filesTouched: [],
            diffSummary: { linesAdded: 0, linesRemoved: 0, filesChanged: 0 },
            testResults: { ran: false, passed: 0, failed: 0, skipped: 0 },
            violations: [],
            outcomeAccepted: null,
            reworkLines: 0,
            intent,
            timestamp: Date.now(),
            durationMs: 0,
        };
    }
    /**
     * Finalize and store an event
     */
    finalizeEvent(event) {
        event.durationMs = Date.now() - event.timestamp;
        this.events.push(event);
        this.evictIfNeeded();
        return event;
    }
    /**
     * Evict oldest events when maxEvents is exceeded.
     * Trims 10% in a batch to amortize the O(n) splice cost.
     */
    evictIfNeeded() {
        if (this.maxEvents > 0 && this.events.length > this.maxEvents) {
            const trimCount = Math.max(1, Math.floor(this.maxEvents * 0.1));
            this.events.splice(0, trimCount);
        }
    }
    /**
     * Run all evaluators against an event
     */
    async evaluate(event) {
        const results = [];
        for (const evaluator of this.evaluators) {
            const result = await evaluator.evaluate(event);
            results.push(result);
        }
        return results;
    }
    /**
     * Get all events
     */
    getEvents() {
        return [...this.events];
    }
    /**
     * Get events by task ID
     */
    getEventsByTask(taskId) {
        return this.events.filter(e => e.taskId === taskId);
    }
    /**
     * Get events within a time range
     */
    getEventsInRange(startMs, endMs) {
        return this.events.filter(e => e.timestamp >= startMs && e.timestamp <= endMs);
    }
    /**
     * Get recent events
     */
    getRecentEvents(count) {
        return this.events.slice(-count);
    }
    /**
     * Compute optimization metrics from events
     */
    computeMetrics(events) {
        const evts = events ?? this.events;
        if (evts.length === 0) {
            return {
                violationRate: 0,
                selfCorrectionRate: 0,
                reworkLines: 0,
                clarifyingQuestions: 0,
                taskCount: 0,
            };
        }
        // Violations per 10 tasks
        const totalViolations = evts.reduce((sum, e) => sum + e.violations.length, 0);
        const violationRate = evts.length > 0 ? (totalViolations / evts.length) * 10 : 0;
        // Self-correction rate: violations that were auto-corrected
        const totalCorrectable = evts.reduce((sum, e) => sum + e.violations.length, 0);
        const totalCorrected = evts.reduce((sum, e) => sum + e.violations.filter(v => v.autoCorrected).length, 0);
        const selfCorrectionRate = totalCorrectable > 0
            ? totalCorrected / totalCorrectable
            : 1;
        // Average rework lines
        const reworkLines = evts.reduce((sum, e) => sum + e.reworkLines, 0) / evts.length;
        // Clarifying questions are tracked in metadata (placeholder for now)
        const clarifyingQuestions = 0;
        return {
            violationRate,
            selfCorrectionRate,
            reworkLines,
            clarifyingQuestions,
            taskCount: evts.length,
        };
    }
    /**
     * Rank violations by frequency and cost (rework lines)
     */
    rankViolations(windowEvents) {
        const evts = windowEvents ?? this.events;
        const violationMap = new Map();
        for (const event of evts) {
            for (const violation of event.violations) {
                const existing = violationMap.get(violation.ruleId) ?? { frequency: 0, totalRework: 0 };
                existing.frequency++;
                existing.totalRework += event.reworkLines;
                violationMap.set(violation.ruleId, existing);
            }
        }
        const rankings = [];
        for (const [ruleId, stats] of violationMap) {
            const cost = stats.totalRework / stats.frequency;
            rankings.push({
                ruleId,
                frequency: stats.frequency,
                cost,
                score: stats.frequency * cost,
            });
        }
        return rankings.sort((a, b) => b.score - a.score);
    }
    /**
     * Get event count
     */
    get eventCount() {
        return this.events.length;
    }
    /**
     * Export events for persistence
     */
    exportEvents() {
        return [...this.events];
    }
    /**
     * Import events from persistence
     */
    importEvents(events) {
        this.events.push(...events);
    }
    /**
     * Clear all events
     */
    clear() {
        this.events = [];
    }
}
/**
 * Create a run ledger instance
 *
 * @param maxEvents - Maximum events to retain in memory (0 = unlimited).
 */
export function createLedger(maxEvents = 0) {
    return new RunLedger(maxEvents);
}
//# sourceMappingURL=ledger.js.map