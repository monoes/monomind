/**
 * runDoctor — Platform health checks for the Monograph knowledge graph.
 *
 * Checks:
 * 1. Node.js version (must be >= 18)
 * 2. SQLite DB file exists at .monomind/monograph.db
 * 3. SQLite DB is readable (SELECT 1)
 * 4. DB node count (warns if graph not built)
 * 5. Disk space (warns if < 100 MB free)
 * 6. Tree-sitter availability
 */
export interface DoctorCheck {
    name: string;
    status: 'ok' | 'warn' | 'error';
    message: string;
}
export interface DoctorResult {
    checks: DoctorCheck[];
    /** true if no 'error' level checks */
    healthy: boolean;
}
/**
 * Run all platform health checks and return a structured result.
 *
 * @param repoPath - Absolute path to the repository root
 * @returns DoctorResult with individual check outcomes and overall health
 *
 * @example
 * const result = await runDoctor('/path/to/repo');
 * if (!result.healthy) console.error('Some checks failed.');
 */
export declare function runDoctor(repoPath: string): Promise<DoctorResult>;
//# sourceMappingURL=doctor.d.ts.map