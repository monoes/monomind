import type { MonographNode, MonographEdge } from '../types.js';
import type { MonographDb } from '../storage/db.js';
export interface RegexNodeMatch {
    node: MonographNode;
    /** Which field of the node matched. */
    field: 'name' | 'filePath' | 'language' | 'label';
}
/**
 * Search nodes whose name, filePath, language, or label matches the given
 * regular expression.
 *
 * @param db      - The MonographDb instance.
 * @param pattern - A RegExp (or a string that will be compiled to one).
 * @param fields  - Which fields to test; default: ['name', 'filePath'].
 */
export declare function regexSearchNodes(db: MonographDb, pattern: RegExp | string, fields?: Array<'name' | 'filePath' | 'language' | 'label'>): RegexNodeMatch[];
export interface RegexEdgeMatch {
    edge: MonographEdge;
    /** Which field of the edge matched. */
    field: 'relation' | 'confidence' | 'reason';
}
/**
 * Search edges whose relation, confidence, or reason matches the given
 * regular expression.
 *
 * @param db      - The MonographDb instance.
 * @param pattern - A RegExp (or a string that will be compiled to one).
 * @param fields  - Which fields to test; default: ['relation', 'reason'].
 */
export declare function regexSearchEdges(db: MonographDb, pattern: RegExp | string, fields?: Array<'relation' | 'confidence' | 'reason'>): RegexEdgeMatch[];
export declare function regexSearchNodesInMemory(nodes: MonographNode[], pattern: RegExp | string, fields?: Array<'name' | 'filePath' | 'language' | 'label'>): RegexNodeMatch[];
export declare function regexSearchEdgesInMemory(edges: MonographEdge[], pattern: RegExp | string, fields?: Array<'relation' | 'confidence' | 'reason'>): RegexEdgeMatch[];
//# sourceMappingURL=regex-search.d.ts.map