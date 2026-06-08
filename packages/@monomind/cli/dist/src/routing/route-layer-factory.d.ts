type RouteResult = any;
export interface ConfiguredRouteLayer {
    route: (taskDescription: string) => Promise<RouteResult>;
}
export declare function createConfiguredRouteLayer(opts?: {
    debug?: boolean;
}): Promise<ConfiguredRouteLayer>;
export {};
//# sourceMappingURL=route-layer-factory.d.ts.map