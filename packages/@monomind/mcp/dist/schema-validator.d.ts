/**
 * @monobrain/mcp - JSON Schema Validator
 *
 * Lightweight JSON Schema validation for tool inputs
 * Implements JSON Schema Draft 2020-12 subset
 */
import type { JSONSchema } from './types.js';
export interface ValidationError {
    path: string;
    message: string;
    keyword: string;
    params?: Record<string, unknown>;
}
export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
}
/**
 * Validate data against JSON Schema
 */
export declare function validateSchema(data: unknown, schema: JSONSchema, path?: string): ValidationResult;
/**
 * Format validation errors for display
 */
export declare function formatValidationErrors(errors: ValidationError[]): string;
/**
 * Create a validator function for a specific schema
 */
export declare function createValidator(schema: JSONSchema): (data: unknown) => ValidationResult;
//# sourceMappingURL=schema-validator.d.ts.map