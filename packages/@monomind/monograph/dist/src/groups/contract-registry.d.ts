/**
 * Contract Registry
 *
 * Extracts HTTP contracts (Route nodes) from per-repo monograph databases,
 * identifies cross-repo links (same method + path in 2+ repos), and
 * persists/loads the registry in a SQLite database.
 */
import Database from 'better-sqlite3';
export interface HttpContract {
    method: string;
    path: string;
    handlerName: string | null;
    handlerFile: string | null;
    repo: string;
}
export interface ContractLink {
    path: string;
    method: string;
    producerRepo: string;
    consumerRepos: string[];
}
/**
 * Extract all HTTP contracts (Route nodes) from a monograph database.
 *
 * Route nodes store method and path together in the `name` field as
 * `"METHOD /path"` (e.g., "GET /api/users"). The handler info is obtained by
 * following HANDLES_ROUTE edges where the Route node is the SOURCE.
 *
 * @param db       - Open better-sqlite3 database handle (read-only acceptable)
 * @param repoName - Logical name for this repo (used to tag returned contracts)
 * @returns Array of HttpContract objects
 */
export declare function extractHttpContracts(db: Database.Database, repoName: string): HttpContract[];
/**
 * Group contracts by (method + path) and identify cross-repo links.
 *
 * A ContractLink is produced for every (method, path) pair that appears in
 * 2 or more repos. The first repo encountered for a given pair is treated as
 * the "producer"; all others become consumers. Repos are deduplicated via Set
 * so a repo appearing multiple times (e.g., two handlers for the same route)
 * is counted only once.
 *
 * @param contracts - Flat list of contracts from all repos
 * @returns Cross-repo contract links
 */
export declare function buildContractLinks(contracts: HttpContract[]): ContractLink[];
/**
 * Persist the contract registry to a SQLite file, overwriting any existing data.
 *
 * Tables created:
 *   - contracts (method, path, handler_name, handler_file, repo)
 *   - links     (path, method, producer_repo, consumer_repos TEXT — JSON array)
 *
 * @param registryPath - Absolute path to the target .contracts.db file
 * @param links        - Cross-repo contract links to store
 * @param contracts    - All individual contracts to store
 */
export declare function saveContractRegistry(registryPath: string, links: ContractLink[], contracts: HttpContract[]): void;
/**
 * Load a previously saved contract registry from disk.
 *
 * @param registryPath - Absolute path to the .contracts.db file
 * @returns Parsed contracts and links, or null if the file does not exist
 */
export declare function loadContractRegistry(registryPath: string): {
    contracts: HttpContract[];
    links: ContractLink[];
} | null;
//# sourceMappingURL=contract-registry.d.ts.map