/**
 * Shared Instructions Generator
 *
 * Auto-detects project profile and generates:
 * 1. .agents/shared_instructions.md  — prepended to every agent prompt
 * 2. Memory seeds — pre-loaded into LanceDB so agents start with project best practices
 */
import type { InitResult } from './types.js';
export interface ProjectProfile {
    name: string;
    description: string;
    language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'unknown';
    framework: string[];
    packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' | 'cargo' | 'poetry' | 'uv' | 'pip' | 'unknown';
    testFramework: string[];
    buildTool: string[];
    isMonorepo: boolean;
    monorepoTool: string;
    database: string[];
    hasDocker: boolean;
    hasCi: boolean;
    ciTool: string;
    maxFileLines: number | null;
    srcDir: string;
    testDir: string;
    version: string;
    isPublicNpm: boolean;
}
export declare function detectProjectProfile(cwd: string): ProjectProfile;
export declare function generateSharedInstructions(profile: ProjectProfile): string;
export interface MemorySeed {
    key: string;
    value: string;
    namespace: string;
}
export declare function generateMemorySeeds(profile: ProjectProfile): MemorySeed[];
export declare function writeSharedInstructions(cwd: string, force: boolean, result: InitResult): void;
//# sourceMappingURL=shared-instructions-generator.d.ts.map