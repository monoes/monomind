export interface McpTool {
    name: string;
    description: string;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
}
export interface McpHttpConfig {
    port?: number;
    host?: string;
    path?: string;
    corsOrigin?: string;
    tools?: McpTool[];
}
export interface McpHttpServer {
    start(): Promise<void>;
    stop(): Promise<void>;
    readonly port: number;
    readonly url: string;
}
export declare function createMcpHttpServer(config?: McpHttpConfig): McpHttpServer;
//# sourceMappingURL=mcp-http.d.ts.map