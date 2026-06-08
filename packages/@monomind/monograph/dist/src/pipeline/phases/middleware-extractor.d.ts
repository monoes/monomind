export type WrapperPattern = 'compose' | 'nested' | 'array' | 'none';
export interface MiddlewareInfo {
    middlewareNames: string[];
    wrapperPattern: WrapperPattern;
}
/**
 * Extracts the middleware chain wrapping a named handler in source code.
 *
 * @param source     Full source text of the handler file.
 * @param handlerName  The name of the handler function to look for.
 * @returns  MiddlewareInfo with names in outermost-first order.
 */
export declare function extractMiddlewareChain(source: string, handlerName: string): MiddlewareInfo;
//# sourceMappingURL=middleware-extractor.d.ts.map