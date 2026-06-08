import type Database from 'better-sqlite3';
export type ReachabilityRole = 'runtime' | 'test' | 'support' | 'unreachable';
/**
 * Classify every File node's reachability role.
 *
 * Entry point detection:
 * - Test entry points: files matching test patterns (*.test.*, *.spec.*, __tests__/*)
 * - Runtime entry points: files with no incoming IMPORTS edges (potential roots)
 * - Support files: *.config.*, scripts/*, tools/* etc.
 *
 * BFS propagation (forward — follows what files import):
 * - From test entry points: mark reachable files as 'test'
 * - From runtime entry points: mark reachable files as 'runtime'
 * - Files reachable from both: 'runtime' wins over 'test'
 * - Nodes reachable from neither: marked 'unreachable'
 * - Config/support files (*.config.*, scripts/*): marked 'support'
 */
export declare function classifyReachability(db: Database.Database, _projectDir: string): {
    runtime: number;
    test: number;
    support: number;
    unreachable: number;
};
/**
 * Get File nodes filtered by reachability role.
 */
export declare function getNodesByReachabilityRole(db: Database.Database, role: ReachabilityRole, limit?: number): Array<{
    id: string;
    name: string;
    filePath: string | null;
}>;
//# sourceMappingURL=reachability.d.ts.map