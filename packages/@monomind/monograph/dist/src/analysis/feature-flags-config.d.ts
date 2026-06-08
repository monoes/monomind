export interface SdkPattern {
    packageName: string;
    displayName: string;
    callPatterns: RegExp[];
}
export declare const KNOWN_SDK_PATTERNS: SdkPattern[];
export declare function detectSdkFromPackageJson(deps: Record<string, string>): SdkPattern[];
//# sourceMappingURL=feature-flags-config.d.ts.map