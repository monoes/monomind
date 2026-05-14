/**
 * Init Executor
 * Main execution logic for V1 initialization
 */
import type { InitOptions, InitResult } from './types.js';
export declare function executeInit(options: InitOptions): Promise<InitResult>;
/**
 * Upgrade result interface
 */
export interface UpgradeResult {
    success: boolean;
    updated: string[];
    created: string[];
    preserved: string[];
    errors: string[];
    /** Added by --add-missing flag */
    addedSkills?: string[];
    addedAgents?: string[];
    addedCommands?: string[];
    /** Added by --settings flag */
    settingsUpdated?: string[];
}
/**
 * Execute upgrade - updates helpers and creates missing metrics without losing data
 * This is safe for existing users who want the latest statusline fixes
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export declare function executeUpgrade(targetDir: string, upgradeSettings?: boolean): Promise<UpgradeResult>;
/**
 * Execute upgrade with --add-missing flag
 * Adds any new skills, agents, and commands that don't exist yet
 * @param targetDir - Target directory
 * @param upgradeSettings - If true, merge new settings into existing settings.json
 */
export declare function executeUpgradeWithMissing(targetDir: string, upgradeSettings?: boolean): Promise<UpgradeResult>;
export default executeInit;
//# sourceMappingURL=executor.d.ts.map