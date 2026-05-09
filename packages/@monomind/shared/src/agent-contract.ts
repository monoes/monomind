/**
 * AgentContract - Compatibility checking between upstream/downstream agent schemas
 * Task 05: Typed Agent I/O Contracts
 */
import { readFileSync, realpathSync, existsSync } from 'fs';
import { resolve, relative, sep } from 'path';
import { SchemaValidator } from './schema-validator.js';

const FORBIDDEN_SCHEMA_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function containsProtoKeys(obj: unknown, depth = 0): boolean {
  if (depth > 10 || obj === null || typeof obj !== 'object') return false;
  for (const k of Object.keys(obj as object)) {
    if (FORBIDDEN_SCHEMA_KEYS.has(k)) return true;
    if (containsProtoKeys((obj as Record<string, unknown>)[k], depth + 1)) return true;
  }
  return false;
}

function isSchemaPathSafe(filePath: string): boolean {
  try {
    const real = realpathSync(filePath);
    const cwd = process.cwd();
    return real === cwd || real.startsWith(cwd + sep);
  } catch {
    const abs = resolve(filePath);
    const cwd = process.cwd();
    const rel = relative(cwd, abs);
    return !rel.startsWith('..') && !rel.startsWith('/');
  }
}

export interface AgentContractConfig {
  upstreamSlug: string;
  upstreamOutputSchema: string;
  downstreamSlug: string;
  downstreamInputSchema: string;
}

export interface CompatibilityReport {
  compatible: boolean;
  upstreamSlug: string;
  downstreamSlug: string;
  issues: string[];
}

interface JsonSchemaShape {
  type?: string;
  required?: string[];
  properties?: Record<string, unknown>;
}

export class AgentContract {
  private validator = new SchemaValidator();

  /**
   * Check whether upstream output schema provides all required fields
   * that the downstream input schema demands.
   */
  check(config: AgentContractConfig): CompatibilityReport {
    const issues: string[] = [];

    let upstreamSchema: JsonSchemaShape;
    let downstreamSchema: JsonSchemaShape;

    if (!isSchemaPathSafe(config.upstreamOutputSchema)) {
      issues.push(`Unsafe upstream output schema path: ${config.upstreamOutputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }
    try {
      const parsed = JSON.parse(readFileSync(config.upstreamOutputSchema, 'utf-8'));
      if (containsProtoKeys(parsed)) throw new Error('Proto-pollution detected in upstream schema');
      upstreamSchema = parsed as JsonSchemaShape;
    } catch {
      issues.push(`Cannot read upstream output schema: ${config.upstreamOutputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }

    if (!isSchemaPathSafe(config.downstreamInputSchema)) {
      issues.push(`Unsafe downstream input schema path: ${config.downstreamInputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }
    try {
      const parsed = JSON.parse(readFileSync(config.downstreamInputSchema, 'utf-8'));
      if (containsProtoKeys(parsed)) throw new Error('Proto-pollution detected in downstream schema');
      downstreamSchema = parsed as JsonSchemaShape;
    } catch {
      issues.push(`Cannot read downstream input schema: ${config.downstreamInputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }

    // Check that every required field in downstream input exists in upstream output properties
    const upstreamProps = upstreamSchema.properties ?? {};
    const downstreamRequired = downstreamSchema.required ?? [];

    for (const field of downstreamRequired) {
      if (!Object.prototype.hasOwnProperty.call(upstreamProps, field)) {
        issues.push(`Downstream "${config.downstreamSlug}" requires field "${field}" which upstream "${config.upstreamSlug}" does not provide`);
      }
    }

    return {
      compatible: issues.length === 0,
      upstreamSlug: config.upstreamSlug,
      downstreamSlug: config.downstreamSlug,
      issues,
    };
  }

  /**
   * Validate actual agent output against its declared output schema.
   */
  validateOutput(output: unknown, outputSchemaPath: string): { valid: boolean; errorMessage: string } {
    const result = this.validator.validateWithJsonSchemaFile(output, outputSchemaPath);
    return {
      valid: result.valid,
      errorMessage: result.valid ? '' : this.validator.formatErrorsForReprompt(result.errors),
    };
  }
}
