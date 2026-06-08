import type { MonographNode, MonographEdge } from '../types.js';
export interface CsvExport {
    nodes: string;
    edges: string;
}
export declare function toCsv(nodes: MonographNode[], edges: MonographEdge[]): CsvExport;
//# sourceMappingURL=csv.d.ts.map