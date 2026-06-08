export interface JSONSchemaProperty {
    type?: string | string[];
    description?: string;
    items?: JSONSchemaProperty;
    properties?: Record<string, JSONSchemaProperty>;
    enum?: unknown[];
    minimum?: number;
    maximum?: number;
    default?: unknown;
    additionalProperties?: boolean | JSONSchemaProperty;
    required?: string[];
    '$ref'?: string;
}
export interface JSONSchema {
    '$schema': string;
    '$id': string;
    title: string;
    description: string;
    type: 'object';
    properties: Record<string, JSONSchemaProperty>;
    additionalProperties: boolean;
}
export declare function generateConfigSchema(): JSONSchema;
export declare function schemaToJson(schema: JSONSchema): string;
//# sourceMappingURL=schema-gen.d.ts.map