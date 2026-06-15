/**
 * Coverage-Aware Routing (ADR-017)
 *
 * Reads real test-coverage data from disk (Jest/Istanbul `coverage-summary.json`,
 * `lcov.info`, or nyc `out.json`), finds files below a coverage threshold, assigns
 * each gap to an appropriate agent, and produces routing/suggestion decisions.
 *
 * Pure, dependency-light: no native packages, no network. Used by the
 * `monomind route coverage` CLI command and the `coverage_*` MCP tools.
 *
 * @module @monomind/cli/monovector/coverage-router
 */
import { existsSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { getProjectCwd } from '../mcp-tools/types.js';
// ============================================================================
// Coverage reader (Jest/Istanbul summary, lcov, nyc)
// ============================================================================
const EMPTY = {
    found: false,
    source: 'none',
    entries: [],
    summary: {
        totalFiles: 0,
        overallLineCoverage: 0,
        overallBranchCoverage: 0,
        overallFunctionCoverage: 0,
        overallStatementCoverage: 0,
    },
};
/** Maximum bytes for a JSON coverage summary (20 MB). */
const MAX_COVERAGE_JSON_BYTES = 20 * 1024 * 1024;
/** Maximum bytes for an lcov.info file (50 MB). */
const MAX_COVERAGE_LCOV_BYTES = 50 * 1024 * 1024;
/**
 * Read coverage data from disk. Checks, in order:
 *  1. coverage/coverage-summary.json  (Jest/Istanbul)
 *  2. coverage-summary.json           (repo root)
 *  3. coverage/lcov.info / lcov.info  (lcov)
 *  4. .nyc_output/out.json            (nyc)
 * Returns `{ found: false }` when no coverage report exists.
 */
export function readCoverage(cwd = getProjectCwd()) {
    for (const rel of ['coverage/coverage-summary.json', 'coverage-summary.json']) {
        const p = join(cwd, rel);
        if (existsSync(p) && statSync(p).size <= MAX_COVERAGE_JSON_BYTES) {
            try {
                return parseSummaryJson(JSON.parse(readFileSync(p, 'utf-8')), rel);
            }
            catch {
                /* malformed — try next */
            }
        }
    }
    for (const rel of ['coverage/lcov.info', 'lcov.info']) {
        const p = join(cwd, rel);
        if (existsSync(p) && statSync(p).size <= MAX_COVERAGE_LCOV_BYTES) {
            try {
                return parseLcov(readFileSync(p, 'utf-8'), rel);
            }
            catch {
                /* malformed — try next */
            }
        }
    }
    const nyc = join(cwd, '.nyc_output', 'out.json');
    if (existsSync(nyc) && statSync(nyc).size <= MAX_COVERAGE_JSON_BYTES) {
        try {
            return parseSummaryJson(JSON.parse(readFileSync(nyc, 'utf-8')), '.nyc_output/out.json');
        }
        catch {
            /* malformed */
        }
    }
    return EMPTY;
}
function pct(covered, total, fallback = 100) {
    if (total == null || total === 0)
        return fallback;
    return ((covered ?? 0) / total) * 100;
}
function parseSummaryJson(data, source) {
    const entries = [];
    let tl = 0, cl = 0, tb = 0, cb = 0, tf = 0, cf = 0, ts = 0, cs = 0;
    for (const [filePath, metrics] of Object.entries(data)) {
        if (filePath === 'total')
            continue;
        const m = metrics;
        if (!m || typeof m !== 'object')
            continue;
        entries.push({
            filePath,
            lines: m.lines?.pct ?? pct(m.lines?.covered, m.lines?.total, 0),
            branches: m.branches?.pct ?? pct(m.branches?.covered, m.branches?.total),
            functions: m.functions?.pct ?? pct(m.functions?.covered, m.functions?.total),
            statements: m.statements?.pct ?? pct(m.statements?.covered, m.statements?.total),
        });
        tl += m.lines?.total ?? 0;
        cl += m.lines?.covered ?? 0;
        tb += m.branches?.total ?? 0;
        cb += m.branches?.covered ?? 0;
        tf += m.functions?.total ?? 0;
        cf += m.functions?.covered ?? 0;
        ts += m.statements?.total ?? 0;
        cs += m.statements?.covered ?? 0;
    }
    const total = data['total'];
    entries.sort((a, b) => a.lines - b.lines);
    return {
        found: true,
        source,
        entries,
        summary: {
            totalFiles: entries.length,
            overallLineCoverage: total?.lines?.pct ?? pct(cl, tl, 0),
            overallBranchCoverage: total?.branches?.pct ?? pct(cb, tb, 0),
            overallFunctionCoverage: total?.functions?.pct ?? pct(cf, tf, 0),
            overallStatementCoverage: total?.statements?.pct ?? pct(cs, ts, 0),
        },
    };
}
function parseLcov(raw, source) {
    const entries = [];
    let file = '';
    let lf = 0, lh = 0, brf = 0, brh = 0, fnf = 0, fnh = 0;
    let tl = 0, cl = 0, tb = 0, cb = 0, tf = 0, cf = 0;
    const flush = () => {
        if (!file)
            return;
        entries.push({
            filePath: file,
            lines: pct(lh, lf, 0),
            branches: pct(brh, brf),
            functions: pct(fnh, fnf),
            statements: pct(lh, lf, 0),
        });
        tl += lf;
        cl += lh;
        tb += brf;
        cb += brh;
        tf += fnf;
        cf += fnh;
        file = '';
        lf = lh = brf = brh = fnf = fnh = 0;
    };
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (t.startsWith('SF:')) {
            flush();
            file = t.slice(3);
        }
        else if (t.startsWith('LF:'))
            lf = Number(t.slice(3)) || 0;
        else if (t.startsWith('LH:'))
            lh = Number(t.slice(3)) || 0;
        else if (t.startsWith('BRF:'))
            brf = Number(t.slice(4)) || 0;
        else if (t.startsWith('BRH:'))
            brh = Number(t.slice(4)) || 0;
        else if (t.startsWith('FNF:'))
            fnf = Number(t.slice(4)) || 0;
        else if (t.startsWith('FNH:'))
            fnh = Number(t.slice(4)) || 0;
        else if (t === 'end_of_record')
            flush();
    }
    flush();
    entries.sort((a, b) => a.lines - b.lines);
    return {
        found: entries.length > 0,
        source,
        entries,
        summary: {
            totalFiles: entries.length,
            overallLineCoverage: pct(cl, tl, 0),
            overallBranchCoverage: pct(cb, tb, 0),
            overallFunctionCoverage: pct(cf, tf, 0),
            overallStatementCoverage: pct(cl, tl, 0),
        },
    };
}
// ============================================================================
// Agent assignment + heuristics
// ============================================================================
/** Assign a coverage gap to the most appropriate agent based on file path. */
export function assignAgent(filePath) {
    const p = filePath.toLowerCase();
    if (/(security|auth|crypto|password|token|permission|sanitiz)/.test(p))
        return 'security-architect';
    if (/(api|route|controller|endpoint|handler|server|http)/.test(p))
        return 'backend-dev';
    if (/(\.tsx|\.jsx|component|ui\/|view|page|render)/.test(p))
        return 'frontend-developer';
    if (/(db|database|migration|schema|model|repository|query)/.test(p))
        return 'backend-dev';
    if (/(util|helper|lib\/|common)/.test(p))
        return 'coder';
    return 'tester';
}
/** Suggest test types based on which coverage dimensions are weakest. */
function suggestTestTypes(entry) {
    const types = [];
    if (entry.lines < 80 || entry.statements < 80)
        types.push('unit');
    if (entry.branches < 80)
        types.push('edge-case');
    if (entry.functions < 80)
        types.push('unit');
    if (entry.lines < 50)
        types.push('integration');
    return Array.from(new Set(types.length ? types : ['unit']));
}
/** Concrete test suggestions for a file below threshold. */
function suggestTests(entry, target) {
    const out = [];
    const base = entry.filePath.replace(/\.[tj]sx?$/, '');
    if (entry.functions < target)
        out.push(`Add unit tests covering untested functions in ${entry.filePath}`);
    if (entry.branches < target)
        out.push(`Add tests for uncovered branches/conditionals (currently ${entry.branches.toFixed(0)}%)`);
    if (entry.lines < 50)
        out.push(`Add an integration test exercising the main path of ${entry.filePath}`);
    out.push(`Create ${base}.test.ts with edge-case and error-path coverage`);
    return out.slice(0, 4);
}
/** Effort estimate (hours) to close a coverage gap on a file. */
function estimateEffort(gap) {
    // ~0.5h per 10% gap, floored at 0.25h, capped at 4h per file.
    return Math.min(4, Math.max(0.25, (gap / 10) * 0.5));
}
function filterByPath(entries, path) {
    if (!path || path === '.' || path === './')
        return entries;
    const norm = path.replace(/^\.\//, '');
    return entries.filter(e => e.filePath.includes(norm));
}
// ============================================================================
// Public API (consumed by route.ts and coverage-tools.ts)
// ============================================================================
/** List coverage gaps below threshold, grouped by assigned agent. */
export async function coverageGaps(opts = {}) {
    const threshold = opts.threshold ?? 80;
    const data = readCoverage();
    if (!data.found) {
        return { found: false, totalGaps: 0, summary: 'No coverage report found. Run your test suite with coverage enabled.', byAgent: {}, gaps: [] };
    }
    const entries = filterByPath(data.entries, opts.path ?? '');
    const gaps = entries
        .filter(e => e.lines < threshold)
        .map(e => ({
        file: e.filePath,
        currentCoverage: e.lines,
        gap: threshold - e.lines,
        suggestedAgent: assignAgent(e.filePath),
    }))
        .sort((a, b) => b.gap - a.gap);
    const byAgent = {};
    for (const g of gaps)
        (byAgent[g.suggestedAgent] ??= []).push(g.file);
    return {
        found: true,
        totalGaps: gaps.length,
        summary: gaps.length === 0
            ? `All ${entries.length} files meet the ${threshold}% threshold.`
            : `${gaps.length} of ${entries.length} files below ${threshold}% (overall ${data.summary.overallLineCoverage.toFixed(1)}%).`,
        byAgent,
        gaps,
    };
}
/** Suggest concrete coverage improvements for a path. */
export async function coverageSuggest(path = '.', opts = {}) {
    const threshold = opts.threshold ?? 80;
    const limit = opts.limit ?? 20;
    const data = readCoverage();
    if (!data.found) {
        return { found: false, path, totalGap: 0, estimatedEffort: 0, suggestions: [] };
    }
    const entries = filterByPath(data.entries, path).filter(e => e.lines < threshold);
    const suggestions = entries
        .map(e => {
        const gap = threshold - e.lines;
        // priority 1–10 from gap size (a 40%+ gap → 10).
        const priority = Math.min(10, Math.max(1, Math.round(gap / 4)));
        return {
            file: e.filePath,
            currentCoverage: e.lines,
            targetCoverage: threshold,
            priority,
            suggestedTests: suggestTests(e, threshold),
        };
    })
        .sort((a, b) => b.priority - a.priority)
        .slice(0, limit);
    const totalGap = entries.reduce((s, e) => s + (threshold - e.lines), 0);
    const estimatedEffort = entries.reduce((s, e) => s + estimateEffort(threshold - e.lines), 0);
    return { found: true, path, totalGap, estimatedEffort, suggestions };
}
/** Produce a coverage-aware routing decision. */
export async function coverageRoute(path = '', opts = {}) {
    const threshold = opts.threshold ?? 80;
    const data = readCoverage();
    if (!data.found) {
        return { found: false, action: 'skip', priority: 0, impactScore: 0, estimatedEffort: 0, testTypes: [], targetFiles: [], gaps: [] };
    }
    const entries = filterByPath(data.entries, path);
    const below = entries.filter(e => e.lines < threshold);
    const overall = data.summary.overallLineCoverage;
    const gaps = below
        .map(e => ({ file: e.filePath, currentCoverage: e.lines, gap: threshold - e.lines }))
        .sort((a, b) => b.gap - a.gap);
    let action;
    if (below.length === 0)
        action = 'skip';
    else if (overall < threshold - 20)
        action = 'prioritize';
    else if (overall < threshold)
        action = 'add-tests';
    else
        action = 'review-coverage';
    // priority 1–10: severity of the worst gap + breadth.
    const worstGap = gaps[0]?.gap ?? 0;
    const breadth = entries.length ? below.length / entries.length : 0;
    const priority = action === 'skip' ? 0 : Math.min(10, Math.max(1, Math.round((worstGap / 5) + breadth * 4)));
    // impactScore 0–100: how far overall coverage sits below threshold — i.e. the
    // headroom (in coverage points) that closing these gaps would reclaim.
    const impactScore = Math.round(Math.min(100, Math.max(0, threshold - overall)));
    const estimatedEffort = Number(below.reduce((s, e) => s + estimateEffort(threshold - e.lines), 0).toFixed(1));
    // aggregate test types across the worst files
    const testTypes = Array.from(new Set(below.slice(0, 10).flatMap(suggestTestTypes)));
    return {
        found: true,
        action,
        priority,
        impactScore,
        estimatedEffort,
        testTypes: testTypes.length ? testTypes : ['unit'],
        targetFiles: gaps.map(g => g.file),
        gaps,
    };
}
//# sourceMappingURL=coverage-router.js.map