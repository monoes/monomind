/**
 * Tests for SchemaValidator (Task 05: Typed Agent I/O Contracts)
 * Uses vitest globals (describe, it, expect, vi, beforeEach, afterEach)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { SchemaValidator } from '../../packages/@monomind/shared/src/schema-validator.js';

const FIXTURE_DIR = join(__dirname, '__fixtures_schema_validator__');

function writeFixture(name: string, content: object): string {
  const filePath = join(FIXTURE_DIR, name);
  writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8');
  return filePath;
}

describe('SchemaValidator', () => {
  let validator: SchemaValidator;

  beforeEach(() => {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    validator = new SchemaValidator();
  });

  afterEach(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  const simpleSchema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string' },
      age: { type: 'integer' },
      role: { type: 'string', enum: ['admin', 'user', 'guest'] },
    },
  };

  it('returns valid=true for a conforming object', () => {
    const schemaPath = writeFixture('simple.json', simpleSchema);
    const result = validator.validateWithJsonSchemaFile({ name: 'Alice', age: 30 }, schemaPath);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid=false for a missing required field with path including field name', () => {
    const schemaPath = writeFixture('simple.json', simpleSchema);
    const result = validator.validateWithJsonSchemaFile({ name: 'Alice' }, schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    const ageError = result.errors.find((e) => e.path.includes('age'));
    expect(ageError).toBeDefined();
    expect(ageError!.message).toContain('age');
  });

  it('returns valid=false for wrong type (not an object)', () => {
    const schemaPath = writeFixture('simple.json', simpleSchema);
    const result = validator.validateWithJsonSchemaFile('not an object', schemaPath);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates enum values', () => {
    const schemaPath = writeFixture('simple.json', simpleSchema);
    const validResult = validator.validateWithJsonSchemaFile({ name: 'Alice', age: 30, role: 'admin' }, schemaPath);
    expect(validResult.valid).toBe(true);

    const invalidResult = validator.validateWithJsonSchemaFile({ name: 'Alice', age: 30, role: 'superadmin' }, schemaPath);
    expect(invalidResult.valid).toBe(false);
    expect(invalidResult.errors.some((e) => e.path.includes('role'))).toBe(true);
  });

  it('caches schema after first load', () => {
    const schemaPath = writeFixture('cached.json', simpleSchema);
    expect(validator.isCached(schemaPath)).toBe(false);

    validator.validateWithJsonSchemaFile({ name: 'Alice', age: 30 }, schemaPath);
    expect(validator.isCached(schemaPath)).toBe(true);

    // Second call still works (uses cache)
    const result = validator.validateWithJsonSchemaFile({ name: 'Bob', age: 25 }, schemaPath);
    expect(result.valid).toBe(true);
  });

  it('formatErrorsForReprompt returns empty string for no errors', () => {
    const output = validator.formatErrorsForReprompt([]);
    expect(output).toBe('');
  });

  it('formatErrorsForReprompt formats field paths', () => {
    const errors = [
      { path: 'name', message: 'Required field "name" is missing' },
      { path: 'details.age', message: 'Expected type "integer" but got "string"' },
    ];
    const output = validator.formatErrorsForReprompt(errors);
    expect(output).toContain('name:');
    expect(output).toContain('details.age:');
    expect(output).toContain('Required field');
  });
});
