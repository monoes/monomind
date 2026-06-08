export interface CliParam {
    name: string;
    type: 'string' | 'boolean' | 'number' | 'array';
    description: string;
    required?: boolean;
    default?: unknown;
    enum?: string[];
}
export interface CliSubcommand {
    name: string;
    description: string;
    params: CliParam[];
}
export interface CliSchema {
    name: string;
    version: string;
    description: string;
    subcommands: CliSubcommand[];
}
export declare function buildCliSchema(version?: string): CliSchema;
export declare function schemaToJsonString(schema: CliSchema): string;
//# sourceMappingURL=cli-schema.d.ts.map