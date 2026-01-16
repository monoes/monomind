/**
 * AgentContract - Compatibility checking between upstream/downstream agent schemas
 * Task 05: Typed Agent I/O Contracts
 */
import { readFileSync } from 'fs';
import { SchemaValidator } from './schema-validator.js';

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

    try {
      upstreamSchema = JSON.parse(readFileSync(config.upstreamOutputSchema, 'utf-8')) as JsonSchemaShape;
    } catch {
      issues.push(`Cannot read upstream output schema: ${config.upstreamOutputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }

    try {
      downstreamSchema = JSON.parse(readFileSync(config.downstreamInputSchema, 'utf-8')) as JsonSchemaShape;
    } catch {
      issues.push(`Cannot read downstream input schema: ${config.downstreamInputSchema}`);
      return { compatible: false, upstreamSlug: config.upstreamSlug, downstreamSlug: config.downstreamSlug, issues };
    }

    // Check that every required field in downstream input exists in upstream output properties
    const upstreamProps = upstreamSchema.properties ?? {};
    const downstreamRequired = downstreamSchema.required ?? [];

    for (const field of downstreamRequired) {
      if (!(field in upstreamProps)) {
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
