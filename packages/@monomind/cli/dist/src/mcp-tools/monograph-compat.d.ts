/**
 * Monograph compatibility shim — @monoes/monograph@1.2.0
 *
 * Only getGroupContracts and getGroupStatus are kept here because they are not
 * exported by the published @monoes/monograph@1.2.0. Everything else has been
 * moved to the real package.
 */
export declare function getGroupContracts(configPath: string): Promise<{
    groupName: string;
    symbol: string;
    filePath: string | null;
    line: number | null;
}[]>;
export declare function getGroupStatus(configPath: string): Promise<{
    totalGroups: number;
    indexedGroups: number;
    stalledGroups: number;
    groups: {
        name: string;
        indexed: boolean;
        stale: boolean;
        contractCount: number;
        lastSync?: string;
    }[];
}>;
//# sourceMappingURL=monograph-compat.d.ts.map