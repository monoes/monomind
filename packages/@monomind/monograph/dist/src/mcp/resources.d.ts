export interface MCPResource {
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    handler: (uri: string) => Promise<{
        content: string;
    }>;
}
export interface MCPToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (input: Record<string, unknown>) => Promise<{
        content: Array<{
            type: 'text';
            text: string;
        }>;
    }>;
}
export declare const monographResources: MCPResource[];
export declare const monographTools: MCPToolDef[];
//# sourceMappingURL=resources.d.ts.map