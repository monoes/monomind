import { describe, expect, it } from 'vitest';
import { doctorTier, groupByTier, nextStep } from '../commands/doctor-groups.js';
import type { DoctorResult } from '../commands/doctor-json.js';

const r = (component: string, status: DoctorResult['status'], fix?: string): DoctorResult => ({
  component,
  name: component.toUpperCase(),
  status,
  message: `${component} ${status}`,
  fix,
});

describe('doctor groups', () => {
  it('assigns tiers', () => {
    expect(doctorTier('node')).toBe('Required');
    expect(doctorTier('monograph')).toBe('Recommended');
    expect(doctorTier('documents')).toBe('Optional');
    expect(doctorTier(undefined)).toBe('Recommended');
  });

  it('hides passes by default and shows them with showAll', () => {
    const results = [r('node', 'pass'), r('monograph', 'warn'), r('documents', 'fail')];
    const def = groupByTier(results, false);
    expect(def.map((g) => g.tier)).toEqual(['Recommended', 'Optional']);
    expect(groupByTier(results, true).map((g) => g.tier)).toEqual([
      'Required',
      'Recommended',
      'Optional',
    ]);
  });

  it('next step prefers a Required failure, then warnings, then all-clear', () => {
    const results = [
      r('monograph', 'warn', 'build graph'),
      r('documents', 'fail', 'x'),
      r('git', 'fail', 'git init'),
    ];
    expect(nextStep(results)).toContain('git init');
    expect(nextStep([r('monograph', 'warn', 'build graph')])).toContain('build graph');
    expect(nextStep([r('node', 'pass')])).toContain('Nothing to fix');
  });
});
