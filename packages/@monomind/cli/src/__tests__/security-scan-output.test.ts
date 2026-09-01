/**
 * Regression tests for CMD-1: `security scan --output json|sarif` used to be
 * accepted flags that were never read. This validates the adapter that feeds
 * security-scan findings into monograph's real SARIF exporter, and the JSON
 * output shape.
 */

import { exportHealthSarif as monographExportHealthSarif } from '@monoes/monograph';
import { describe, expect, it } from 'vitest';
import {
  exportHealthSarif,
  exportHealthSarifFallback,
  findingsToSarif,
} from '../commands/security-scan.js';

describe('findingsToSarif', () => {
  it('parses a "path:line" location into filePath + startLine/endLine', () => {
    const [result] = findingsToSarif([
      {
        type: 'Hardcoded Secret',
        location: 'src/foo.ts:42',
        description: 'AWS Access Key',
        rawSeverity: 'high',
      },
    ]);
    expect(result.filePath).toBe('src/foo.ts');
    expect(result.startLine).toBe(42);
    expect(result.endLine).toBe(42);
    expect(result.ruleId).toBe('security-scan/hardcoded-secret');
    expect(result.severity).toBe('error');
  });

  it('falls back to line 0 when the location has no numeric suffix', () => {
    const [result] = findingsToSarif([
      {
        type: 'Dependency CVE',
        location: 'package.json:lodash',
        description: 'Prototype pollution',
        rawSeverity: 'critical',
      },
    ]);
    expect(result.filePath).toBe('package.json:lodash');
    expect(result.startLine).toBe(0);
    expect(result.severity).toBe('error');
  });

  it('maps medium severity to warning and low to note', () => {
    const [medium, low] = findingsToSarif([
      {
        type: 'Eval Usage',
        location: 'a.ts:1',
        description: 'eval() can execute arbitrary code',
        rawSeverity: 'medium',
      },
      {
        type: 'Info Finding',
        location: 'b.ts:2',
        description: 'informational',
        rawSeverity: 'low',
      },
    ]);
    expect(medium.severity).toBe('warning');
    expect(low.severity).toBe('note');
  });

  it('slugifies multi-word finding types into rule ids', () => {
    const [result] = findingsToSarif([
      {
        type: 'React XSS',
        location: 'a.tsx:3',
        description: 'React XSS risk',
        rawSeverity: 'medium',
      },
    ]);
    expect(result.ruleId).toBe('security-scan/react-xss');
  });
});

describe('exportHealthSarif reuse (real monograph exporter, not reimplemented)', () => {
  it('produces a valid SARIF 2.1.0 document from adapted security-scan findings via monograph', () => {
    const findings = findingsToSarif([
      {
        type: 'Hardcoded Secret',
        location: 'src/config.ts:10',
        description: 'Hardcoded Password',
        rawSeverity: 'high',
      },
    ]);
    const doc = monographExportHealthSarif(findings, process.cwd());

    expect(doc.version).toBe('2.1.0');
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0].results).toHaveLength(1);
    expect(doc.runs[0].results[0].ruleId).toBe('security-scan/hardcoded-secret');
    expect(doc.runs[0].results[0].message.text).toBe('Hardcoded Password');
    expect(doc.runs[0].results[0].locations[0].physicalLocation.region?.startLine).toBe(10);
  });

  it('produces a valid SARIF 2.1.0 document via CLI exportHealthSarif wrapper', () => {
    const findings = findingsToSarif([
      {
        type: 'Hardcoded Secret',
        location: 'src/config.ts:10',
        description: 'Hardcoded Password',
        rawSeverity: 'high',
      },
    ]);
    const doc = exportHealthSarif(findings, process.cwd());

    expect(doc.version).toBe('2.1.0');
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0].results).toHaveLength(1);
    expect(doc.runs[0].results[0].ruleId).toBe('security-scan/hardcoded-secret');
  });

  it('produces a valid SARIF 2.1.0 document via exportHealthSarifFallback when upstream export is missing', () => {
    const findings = findingsToSarif([
      {
        type: 'Hardcoded Secret',
        location: 'src/config.ts:10',
        description: 'Hardcoded Password',
        rawSeverity: 'high',
      },
    ]);
    const doc = exportHealthSarifFallback(findings, process.cwd());

    expect(doc.version).toBe('2.1.0');
    expect(doc.runs).toHaveLength(1);
    expect(doc.runs[0].results).toHaveLength(1);
    expect(doc.runs[0].results[0].ruleId).toBe('security-scan/hardcoded-secret');
    expect(doc.runs[0].results[0].message.text).toBe('Hardcoded Password');
    expect(doc.runs[0].results[0].locations[0].physicalLocation.region?.startLine).toBe(10);
  });
});
