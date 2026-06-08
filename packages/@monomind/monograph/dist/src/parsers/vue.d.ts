import type { LanguageConfig } from './language-config.js';
export declare const vueConfig: LanguageConfig;
/**
 * Extracts the <script> block content from a Vue SFC source string.
 * Returns the inner content (stripping the <script> tags) and whether it is TypeScript.
 */
export declare function extractVueScriptContent(source: string): {
    content: string;
    isTypeScript: boolean;
};
//# sourceMappingURL=vue.d.ts.map