export type GrpcRole = 'provider' | 'consumer';
export interface GrpcContract {
    serviceName: string;
    role: GrpcRole;
    methods: string[];
    filePath: string;
    packageName?: string;
}
export declare function extractGrpcContracts(source: string, filePath: string): GrpcContract[];
//# sourceMappingURL=grpc-extractor.d.ts.map