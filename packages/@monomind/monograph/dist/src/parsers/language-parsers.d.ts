export type SupportedLanguage = 'scala' | 'lua' | 'zig' | 'powershell' | 'elixir';
export interface SymbolExtract {
    name: string;
    label: 'Function' | 'Class' | 'Module' | 'Namespace';
    isExported: boolean;
    line: number;
    filePath: string;
}
export declare function extractSymbolsForLanguage(source: string, filePath: string, language: SupportedLanguage): SymbolExtract[];
export declare const LANGUAGE_EXTENSIONS: Record<string, SupportedLanguage>;
//# sourceMappingURL=language-parsers.d.ts.map