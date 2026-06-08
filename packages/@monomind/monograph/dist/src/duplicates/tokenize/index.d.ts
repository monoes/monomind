import type { FileTokens } from '../token-types.js';
export declare function tokenizeFile(filePath: string, source: string, skipImports: boolean): FileTokens;
export declare function tokenizeFileCrossLanguage(filePath: string, source: string, stripTypes: boolean, skipImports: boolean): FileTokens;
export declare function tokenizeSfc(source: string, stripTypes: boolean, skipImports: boolean): FileTokens;
export declare function tokenizeAstro(source: string, stripTypes: boolean, skipImports: boolean): FileTokens;
export declare function tokenizeMdx(source: string, stripTypes: boolean, skipImports: boolean): FileTokens;
export declare function tokenizeJsTs(_filePath: string, source: string, _stripTypes: boolean, skipImports: boolean): FileTokens;
//# sourceMappingURL=index.d.ts.map