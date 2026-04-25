/**
 * SchemaValidator - JSON Schema and Zod validation for agent I/O contracts
 * Task 05: Typed Agent I/O Contracts
 */
import { readFileSync } from 'fs';

export interface ValidationError {
  path: string;
  message: string;
  received?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

interface JsonSchema {
  type?: string;
  required?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: unknown[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}

export class SchemaValidator {
  private schemaCache: Map<string, JsonSchema> = new Map();

  /**
   * Validate data against a JSON Schema file loaded from disk.
   * Caches the schema after the first load.
   */
  validateWithJsonSchemaFile(data: unknown, schemaPath: string): ValidationResult {
    let schema = this.schemaCache.get(schemaPath);
    if (!schema) {
      const raw = readFileSync(schemaPath, 'utf-8');
      schema = JSON.parse(raw) as JsonSchema;
      this.schemaCache.set(schemaPath, schema);
    }
    return this.validateAgainstSchema(data, schema, '');
  }

  /**
   * Validate data against a Zod schema.
   */
  validateWithZod(data: unknown, zodSchema: { safeParse: (d: unknown) => { success: boolean; error?: { issues: Array<{ path: (string | number)[]; message: string }> } } }): ValidationResult {
    const result = zodSchema.safeParse(data);
    if (result.success) {
      return { valid: true, errors: [] };
    }
    const errors: ValidationError[] = (result.error?.issues ?? []).map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return { valid: false, errors };
  }

  /**
   * Format validation errors into a human-readable string suitable for re-prompting an agent.
   */
  formatErrorsForReprompt(errors: ValidationError[]): string {
    if (errors.length === 0) return '';
    return errors.map((e) => `- ${e.path ? e.path + ': ' : ''}${e.message}`).join('\n');
  }

  /**
   * Clear the schema cache (useful for testing).
   */
  clearCache(): void {
    this.schemaCache.clear();
  }

  /**
   * Check whether a schema path is cached.
   */
  isCached(schemaPath: string): boolean {
    return this.schemaCache.has(schemaPath);
  }

  // ---------------------------------------------------------------------------
  // Internal minimal JSON Schema validator
  // ---------------------------------------------------------------------------

  private validateAgainstSchema(data: unknown, schema: JsonSchema, path: string): ValidationResult {
    const errors: ValidationError[] = [];

    // Type check
    if (schema.type) {
      const actualType = this.jsonType(data);
      if (schema.type !== actualType) {
        errors.push({ path: path || '(root)', message: `Expected type "${schema.type}" but got "${actualType}"`, received: data });
        return { valid: false, errors };
      }
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push({ path: path || '(root)', message: `Value must be one of: ${schema.enum.join(', ')}`, received: data });
    }

    // String constraints
    if (schema.type === 'string' && typeof data === 'string') {
      if (schema.minLength !== undefined && data.length < schema.minLength) {
        errors.push({ path: path || '(root)', message: `String must have at least ${schema.minLength} characters`, received: data });
      }
      if (schema.maxLength !== undefined && data.length > schema.maxLength) {
        errors.push({ path: path || '(root)', message: `String must have at most ${schema.maxLength} characters`, received: data });
      }
    }

    // Number constraints
    if ((schema.type === 'number' || schema.type === 'integer') && typeof data === 'number') {
      if (schema.minimum !== undefined && data < schema.minimum) {
        errors.push({ path: path || '(root)', message: `Value must be >= ${schema.minimum}`, received: data });
      }
      if (schema.maximum !== undefined && data > schema.maximum) {
        errors.push({ path: path || '(root)', message: `Value must be <= ${schema.maximum}`, received: data });
      }
    }

    // Object validation
    if (schema.type === 'object' && typeof data === 'object' && data !== null && !Array.isArray(data)) {
      const obj = data as Record<string, unknown>;

      // Required fields
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in obj)) {
            errors.push({ path: path ? `${path}.${field}` : field, message: `Required field "${field}" is missing` });
          }
        }
      }

      // Property validation
      if (schema.properties) {
        for (const [key, propSchema] of Object.entries(schema.properties)) {
          if (key in obj) {
            const propPath = path ? `${path}.${key}` : key;
            const result = this.validateAgainstSchema(obj[key], propSchema, propPath);
            errors.push(...result.errors);
          }
        }
      }
    }

    // Array validation
    if (schema.type === 'array' && Array.isArray(data) && schema.items) {
      for (let i = 0; i < data.length; i++) {
        const itemPath = `${path}[${i}]`;
        const result = this.validateAgainstSchema(data[i], schema.items, itemPath);
        errors.push(...result.errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  private jsonType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'integer' : 'number';
    }
    return typeof value;
  }
}
