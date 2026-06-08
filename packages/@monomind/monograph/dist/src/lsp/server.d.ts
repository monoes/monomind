import type { MonographDb } from '../storage/db.js';
export interface LspDiagnostic {
    uri: string;
    range: {
        start: {
            line: number;
            character: number;
        };
        end: {
            line: number;
            character: number;
        };
    };
    severity: 1 | 2 | 3 | 4;
    source: 'monograph';
    message: string;
    code?: string;
}
export declare function buildDiagnosticsFromDb(db: MonographDb, repoRoot: string): Map<string, LspDiagnostic[]>;
export declare function startLspServer(db: MonographDb, repoRoot: string): void;
//# sourceMappingURL=server.d.ts.map