/**
 * Tests for the capability metadata validation logic.
 *
 * @module tests/scripts/validate-capability-metadata.test
 */

import { describe, it, expect } from 'vitest';
import { validateCapability } from '../../scripts/validate-capability-metadata';

describe('validateCapability', () => {
  const FILE = 'test-agent.md';

  const validCapability = {
    role: 'security-engineer',
    goal: 'Identify and remediate security vulnerabilities in code and infrastructure',
    version: '1.0.0',
    expertise: [
      'application security',
      'OWASP Top 10',
      'CVE analysis and remediation',
    ],
    task_types: ['security-audit'],
    output_type: 'SecurityAuditReport',
  };

  it('should return no errors for a valid capability block', () => {
    const errors = validateCapability(FILE, { ...validCapability });
    expect(errors).toEqual([]);
  });

  describe('role validation', () => {
    it('should report missing role', () => {
      const cap = { ...validCapability, role: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'role', message: expect.stringContaining('Missing') }),
        ])
      );
    });

    it('should reject non-kebab-case role', () => {
      const cap = { ...validCapability, role: 'SecurityEngineer' };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'role', message: expect.stringContaining('kebab-case') }),
        ])
      );
    });
  });

  describe('goal validation', () => {
    it('should report missing goal', () => {
      const cap = { ...validCapability, goal: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'goal', message: expect.stringContaining('Missing') }),
        ])
      );
    });

    it('should reject goal shorter than 20 characters', () => {
      const cap = { ...validCapability, goal: 'Fix bugs' };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'goal',
            message: expect.stringContaining('at least 20 chars'),
          }),
        ])
      );
    });

    it('should reject goal longer than 200 characters', () => {
      const cap = { ...validCapability, goal: 'A'.repeat(201) };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'goal',
            message: expect.stringContaining('at most 200 chars'),
          }),
        ])
      );
    });
  });

  describe('version validation', () => {
    it('should report missing version', () => {
      const cap = { ...validCapability, version: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'version', message: expect.stringContaining('Missing') }),
        ])
      );
    });

    it('should reject non-semver version', () => {
      const cap = { ...validCapability, version: 'v1.0' };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'version',
            message: expect.stringContaining('not valid semver'),
          }),
        ])
      );
    });

    it('should accept valid semver version', () => {
      const cap = { ...validCapability, version: '2.1.3' };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual([]);
    });
  });

  describe('expertise validation', () => {
    it('should report missing expertise', () => {
      const cap = { ...validCapability, expertise: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'expertise',
            message: expect.stringContaining('Missing'),
          }),
        ])
      );
    });

    it('should reject expertise with fewer than 3 entries', () => {
      const cap = { ...validCapability, expertise: ['one', 'two'] };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'expertise',
            message: expect.stringContaining('at least 3 entries'),
          }),
        ])
      );
    });

    it('should accept expertise with exactly 3 entries', () => {
      const cap = { ...validCapability, expertise: ['a', 'b', 'c'] };
      const errors = validateCapability(FILE, cap);
      const expertiseErrors = errors.filter((e) => e.field === 'expertise');
      expect(expertiseErrors).toEqual([]);
    });
  });

  describe('task_types validation', () => {
    it('should report missing task_types', () => {
      const cap = { ...validCapability, task_types: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'task_types',
            message: expect.stringContaining('Missing'),
          }),
        ])
      );
    });

    it('should reject empty task_types array', () => {
      const cap = { ...validCapability, task_types: [] as string[] };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'task_types',
            message: expect.stringContaining('at least 1 entry'),
          }),
        ])
      );
    });
  });

  describe('output_type validation', () => {
    it('should report missing output_type', () => {
      const cap = { ...validCapability, output_type: undefined };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'output_type',
            message: expect.stringContaining('Missing'),
          }),
        ])
      );
    });

    it('should reject non-PascalCase output_type', () => {
      const cap = { ...validCapability, output_type: 'security-report' };
      const errors = validateCapability(FILE, cap);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'output_type',
            message: expect.stringContaining('not PascalCase'),
          }),
        ])
      );
    });
  });

  describe('multiple missing fields', () => {
    it('should report all missing required fields', () => {
      const errors = validateCapability(FILE, {});
      const fields = errors.map((e) => e.field);
      expect(fields).toContain('role');
      expect(fields).toContain('goal');
      expect(fields).toContain('version');
      expect(fields).toContain('expertise');
      expect(fields).toContain('task_types');
      expect(fields).toContain('output_type');
      expect(errors.length).toBe(6);
    });
  });
});
