export interface ValidationError {
    field: string;
    message: string;
    line?: number;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
}
export declare function validateConfig(configPath: string): ValidationResult;
//# sourceMappingURL=validate.d.ts.map