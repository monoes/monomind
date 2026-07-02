/**
 * Doctor — system/environment health checks
 * Node, npm, git, disk, TypeScript, Claude CLI, version freshness
 */
export declare const MAX_DOCTOR_PKG_BYTES: number;
export declare const MAX_DOCTOR_CONFIG_BYTES: number;
export declare const MAX_DOCTOR_GITIGNORE_BYTES: number;
export declare const MAX_DOCTOR_PID_BYTES = 64;
export declare const MAX_DOCTOR_HELPER_BYTES: number;
export interface HealthCheck {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    message: string;
    fix?: string;
}
export declare function runCommand(command: string, timeoutMs?: number): Promise<string>;
export declare function checkNodeVersion(): Promise<HealthCheck>;
export declare function checkNpmVersion(): Promise<HealthCheck>;
export declare function checkGit(): Promise<HealthCheck>;
export declare function checkGitRepo(): Promise<HealthCheck>;
export declare function checkDiskSpace(): Promise<HealthCheck>;
export declare function checkBuildTools(): Promise<HealthCheck>;
export declare function checkVersionFreshness(): Promise<HealthCheck>;
export declare function checkClaudeCode(): Promise<HealthCheck>;
export declare function installClaudeCode(): Promise<boolean>;
//# sourceMappingURL=doctor-env-checks.d.ts.map