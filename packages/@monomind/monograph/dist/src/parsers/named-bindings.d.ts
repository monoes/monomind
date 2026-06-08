export type BindingLanguage = 'typescript' | 'javascript' | 'python' | 'java' | 'kotlin' | 'go' | 'rust';
export interface NamedBinding {
    decoratorName: string;
    targetName: string | null;
    hasArguments: boolean;
    line: number;
    filePath: string;
}
export declare function extractNamedBindings(source: string, filePath: string, language: BindingLanguage): NamedBinding[];
//# sourceMappingURL=named-bindings.d.ts.map