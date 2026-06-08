/**
 * Contract Bridge Detection
 *
 * Finds shared type definitions (Interface, Type, Class) that appear across
 * multiple repos in a group — these are potential contract bridges.
 */
import type { GroupConfig } from './group-config.js';
export interface ContractBridge {
    /** Shared type name */
    name: string;
    /** Repo names that define this type */
    repos: string[];
    /** Node labels (Interface, Type, Class, etc.) */
    labels: string[];
}
/**
 * Detect contract bridges: type names shared across >= 2 repos.
 * Results sorted by number of repos descending.
 *
 * @param groupConfig - Parsed group configuration
 * @returns List of ContractBridge entries
 */
export declare function detectContractBridges(groupConfig: GroupConfig): Promise<ContractBridge[]>;
//# sourceMappingURL=contract-bridge.d.ts.map