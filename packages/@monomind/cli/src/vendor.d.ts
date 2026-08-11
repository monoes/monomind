declare module 'sql.js' {
  const initSqlJs: (...args: any[]) => Promise<any>;
  export = initSqlJs;
}

declare module '@xenova/transformers' {
  export const pipeline: (...args: any[]) => Promise<any>;
  export const env: any;
  export const AutoTokenizer: any;
  export const AutoModel: any;
  export const CLIPTextModelWithProjection: any;
  export const CLIPVisionModelWithProjection: any;
  export const FeatureExtractionPipeline: any;
}

declare module 'pdf-parse' {
  function pdfParse(data: Buffer): Promise<{ text: string; numpages: number; info: any }>;
  export = pdfParse;
}

declare module 'mammoth' {
  export function extractRawText(options: { path: string }): Promise<{ value: string }>;
}

declare module 'exifreader' {
  export function load(data: Buffer | ArrayBuffer, options?: any): Record<string, any>;
}

declare module 'monovector' {
  export const MonoVector: any;
  export const createIndex: (...args: any[]) => any;
  export default any;
}

/**
 * @monoes/mcp is an optional peer dependency resolved at runtime (the CLI
 * only needs it when an external MCP client connects over HTTP/WS). Typed
 * loosely as `any` to avoid hard-coupling the build to a sibling workspace
 * package that may be absent in production installs.
 */
declare module '@monoes/mcp';
