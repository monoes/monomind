/**
 * Coverage utilities for hooks commands.
 * Extracted from hooks.ts (ARCH-1) — reads Jest/Istanbul/lcov coverage files from disk.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Read coverage data from disk. Checks these locations in order:
 * 1. coverage/coverage-summary.json (Jest/Istanbul)
 * 2. coverage/lcov.info (lcov format)
 * 3. .nyc_output/out.json (nyc)
 */
export function readCoverageFromDisk() {
    const cwd = process.cwd();
    const noData = {
        found: false,
        source: 'none',
        entries: [],
        summary: { totalFiles: 0, overallLineCoverage: 0, overallBranchCoverage: 0, overallFunctionCoverage: 0, overallStatementCoverage: 0 },
    };
    // 1. Try coverage-summary.json (Jest/Istanbul)
    for (const relPath of ['coverage/coverage-summary.json', 'coverage-summary.json']) {
        const summaryPath = join(cwd, relPath);
        if (existsSync(summaryPath)) {
            try {
                if (statSync(summaryPath).size <= 4_194_304) {
                    const raw = JSON.parse(readFileSync(summaryPath, 'utf-8'));
                    return parseCoverageSummaryJson(raw, relPath);
                }
            }
            catch {
                // malformed, try next
            }
        }
    }
    // 2. Try lcov.info
    for (const relPath of ['coverage/lcov.info', 'lcov.info']) {
        const lcovPath = join(cwd, relPath);
        if (existsSync(lcovPath)) {
            try {
                if (statSync(lcovPath).size <= 8_388_608) {
                    const raw = readFileSync(lcovPath, 'utf-8');
                    return parseLcovInfo(raw, relPath);
                }
            }
            catch {
                // malformed, try next
            }
        }
    }
    // 3. Try .nyc_output/out.json
    const nycPath = join(cwd, '.nyc_output', 'out.json');
    if (existsSync(nycPath)) {
        try {
            if (statSync(nycPath).size <= 4_194_304) {
                const raw = JSON.parse(readFileSync(nycPath, 'utf-8'));
                return parseCoverageSummaryJson(raw, '.nyc_output/out.json');
            }
        }
        catch {
            // malformed
        }
    }
    return noData;
}
function parseCoverageSummaryJson(data, source) {
    const entries = [];
    let totalLines = 0, coveredLines = 0;
    let totalBranches = 0, coveredBranches = 0;
    let totalFunctions = 0, coveredFunctions = 0;
    let totalStatements = 0, coveredStatements = 0;
    for (const [filePath, metrics] of Object.entries(data)) {
        if (filePath === 'total')
            continue;
        const m = metrics;
        if (!m || typeof m !== 'object')
            continue;
        const linePct = m.lines?.pct ?? (m.lines?.covered != null ? ((m.lines?.covered ?? 0) / Math.max(m.lines?.total ?? 1, 1)) * 100 : 0);
        const branchPct = m.branches?.pct ?? (m.branches?.total ? ((m.branches?.covered ?? 0) / m.branches.total) * 100 : 100);
        const funcPct = m.functions?.pct ?? (m.functions?.total ? ((m.functions?.covered ?? 0) / m.functions.total) * 100 : 100);
        const stmtPct = m.statements?.pct ?? (m.statements?.total ? ((m.statements?.covered ?? 0) / m.statements.total) * 100 : 100);
        entries.push({ filePath, lines: linePct, branches: branchPct, functions: funcPct, statements: stmtPct });
        totalLines += m.lines?.total ?? 0;
        coveredLines += m.lines?.covered ?? 0;
        totalBranches += m.branches?.total ?? 0;
        coveredBranches += m.branches?.covered ?? 0;
        totalFunctions += m.functions?.total ?? 0;
        coveredFunctions += m.functions?.covered ?? 0;
        totalStatements += m.statements?.total ?? 0;
        coveredStatements += m.statements?.covered ?? 0;
    }
    // Also read the total key if present
    const total = data['total'];
    const overallLine = total?.lines?.pct ?? (totalLines > 0 ? (coveredLines / totalLines) * 100 : 0);
    const overallBranch = total?.branches?.pct ?? (totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0);
    const overallFunction = total?.functions?.pct ?? (totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0);
    const overallStatement = total?.statements?.pct ?? (totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0);
    // Sort by lowest line coverage
    entries.sort((a, b) => a.lines - b.lines);
    return {
        found: true,
        source,
        entries,
        summary: {
            totalFiles: entries.length,
            overallLineCoverage: overallLine,
            overallBranchCoverage: overallBranch,
            overallFunctionCoverage: overallFunction,
            overallStatementCoverage: overallStatement,
        },
    };
}
function parseLcovInfo(raw, source) {
    const entries = [];
    let currentFile = '';
    let linesHit = 0, linesFound = 0;
    let branchesHit = 0, branchesFound = 0;
    let functionsHit = 0, functionsFound = 0;
    let totalLines = 0, coveredLines = 0;
    let totalBranches = 0, coveredBranches = 0;
    let totalFunctions = 0, coveredFunctions = 0;
    let totalStatements = 0, coveredStatements = 0;
    const flushRecord = () => {
        if (currentFile) {
            entries.push({
                filePath: currentFile,
                lines: linesFound > 0 ? (linesHit / linesFound) * 100 : 0,
                branches: branchesFound > 0 ? (branchesHit / branchesFound) * 100 : 100,
                functions: functionsFound > 0 ? (functionsHit / functionsFound) * 100 : 100,
                statements: linesFound > 0 ? (linesHit / linesFound) * 100 : 0,
            });
            totalLines += linesFound;
            coveredLines += linesHit;
            totalBranches += branchesFound;
            coveredBranches += branchesHit;
            totalFunctions += functionsFound;
            coveredFunctions += functionsHit;
            totalStatements += linesFound;
            coveredStatements += linesHit;
        }
    };
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('SF:')) {
            currentFile = trimmed.slice(3);
            linesHit = 0;
            linesFound = 0;
            branchesHit = 0;
            branchesFound = 0;
            functionsHit = 0;
            functionsFound = 0;
        }
        else if (trimmed.startsWith('LH:')) {
            linesHit = parseInt(trimmed.slice(3), 10) || 0;
        }
        else if (trimmed.startsWith('LF:')) {
            linesFound = parseInt(trimmed.slice(3), 10) || 0;
        }
        else if (trimmed.startsWith('BRH:')) {
            branchesHit = parseInt(trimmed.slice(4), 10) || 0;
        }
        else if (trimmed.startsWith('BRF:')) {
            branchesFound = parseInt(trimmed.slice(4), 10) || 0;
        }
        else if (trimmed.startsWith('FNH:')) {
            functionsHit = parseInt(trimmed.slice(4), 10) || 0;
        }
        else if (trimmed.startsWith('FNF:')) {
            functionsFound = parseInt(trimmed.slice(4), 10) || 0;
        }
        else if (trimmed === 'end_of_record') {
            flushRecord();
            currentFile = '';
        }
    }
    flushRecord();
    entries.sort((a, b) => a.lines - b.lines);
    return {
        found: true,
        source,
        entries,
        summary: {
            totalFiles: entries.length,
            overallLineCoverage: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
            overallBranchCoverage: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 100,
            overallFunctionCoverage: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
            overallStatementCoverage: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
        },
    };
}
/**
 * Classify a coverage gap by priority type based on coverage percentage and threshold
 */
export function classifyCoverageGap(coveragePct, threshold) {
    if (coveragePct < threshold * 0.25)
        return { gapType: 'critical', priority: 10 };
    if (coveragePct < threshold * 0.5)
        return { gapType: 'high', priority: 7 };
    if (coveragePct < threshold * 0.75)
        return { gapType: 'medium', priority: 5 };
    if (coveragePct < threshold)
        return { gapType: 'low', priority: 3 };
    return { gapType: 'ok', priority: 0 };
}
/**
 * Suggest agents for a file based on its path
 */
export function suggestAgentsForFile(filePath) {
    const lower = filePath.toLowerCase();
    if (lower.includes('test') || lower.includes('spec'))
        return ['tester'];
    if (lower.includes('security') || lower.includes('auth'))
        return ['security-auditor', 'tester'];
    if (lower.includes('api') || lower.includes('route') || lower.includes('controller'))
        return ['coder', 'tester'];
    if (lower.includes('model') || lower.includes('schema') || lower.includes('entity'))
        return ['coder', 'tester'];
    return ['tester', 'coder'];
}
//# sourceMappingURL=hooks-coverage-utils.js.map