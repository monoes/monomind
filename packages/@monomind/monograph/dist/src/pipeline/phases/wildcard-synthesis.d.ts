import type { MonographNode, MonographEdge } from '../../types.js';
export interface WildcardBinding {
    /** The namespace alias, e.g. `X` in `import * as X from './module'` */
    alias: string;
    /** The module specifier, e.g. `./module` */
    moduleSpecifier: string;
}
export interface WildcardMemberAccess {
    alias: string;
    member: string;
    line: number;
}
export interface WildcardSynthesisResult {
    /** New edges synthesized from wildcard member accesses */
    synthesizedEdges: MonographEdge[];
}
/**
 * Extracts all wildcard import bindings from a TypeScript/JavaScript source file.
 *
 * @param source - Raw source code content
 * @returns Array of wildcard bindings found in the source
 */
export declare function extractWildcardBindings(source: string): WildcardBinding[];
/**
 * Extracts all member accesses for a given namespace alias from source code.
 * e.g. for alias `ns`, detects `ns.foo`, `ns.bar`, etc.
 *
 * @param source - Raw source code content
 * @param alias - The namespace alias to scan for
 * @returns Array of member accesses with line numbers
 */
export declare function extractWildcardMemberAccesses(source: string, alias: string): WildcardMemberAccess[];
/**
 * Synthesizes direct symbol edges from wildcard namespace member accesses.
 *
 * Given source code that has `import * as X from './module'` and uses `X.foo`,
 * this function creates IMPORTS edges from the source file node to the `foo`
 * export node in `./module`.
 *
 * @param sourceFileId - The node ID of the file containing the wildcard import
 * @param source - Raw source code of the file
 * @param nodes - All known nodes in the graph
 * @param edges - All known edges (used to avoid duplicates)
 * @returns Synthesized edges that directly link callers to target exports
 */
export declare function synthesizeWildcardImports(sourceFileId: string, source: string, nodes: MonographNode[], edges: MonographEdge[]): WildcardSynthesisResult;
//# sourceMappingURL=wildcard-synthesis.d.ts.map