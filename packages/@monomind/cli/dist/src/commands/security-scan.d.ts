/**
 * Security scan commands — code/dep/container scanning and secret detection
 */
import type { Command } from '../types.js';
export declare const SECRET_PATTERNS: Array<{
    pattern: RegExp;
    type: string;
}>;
export type SecretFinding = {
    severity: string;
    type: string;
    location: string;
    description: string;
};
export declare function findSecretsInDir(dir: string, depthLimit: number, baseDir: string, findings: SecretFinding[]): void;
export declare const scanCommand: Command;
export declare const secretsCommand: Command;
//# sourceMappingURL=security-scan.d.ts.map