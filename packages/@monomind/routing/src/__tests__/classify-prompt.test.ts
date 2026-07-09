import { describe, it, expect } from 'vitest';
import { buildClassificationPrompt } from '../prompts/classify.js';

describe('buildClassificationPrompt', () => {
  it('includes the task description', () => {
    const prompt = buildClassificationPrompt('fix the login bug', 'coder: code', '- coder (similarity: 0.8)');
    expect(prompt).toContain('fix the login bug');
  });

  it('includes the capability index', () => {
    const capIndex = 'coder: General code\ntester: Testing';
    const prompt = buildClassificationPrompt('task', capIndex, '');
    expect(prompt).toContain(capIndex);
  });

  it('includes candidate hints', () => {
    const hints = '- coder (similarity: 0.850)\n- tester (similarity: 0.720)';
    const prompt = buildClassificationPrompt('task', '', hints);
    expect(prompt).toContain(hints);
  });

  it('contains instruction to output only the agent slug', () => {
    const prompt = buildClassificationPrompt('task', '', '');
    expect(prompt).toContain('ONLY the agent slug');
  });

  it('references the Available Agents section', () => {
    const prompt = buildClassificationPrompt('task', 'index-content', '');
    expect(prompt).toContain('## Available Agents');
  });

  it('references the Semantic Pre-Candidates section', () => {
    const prompt = buildClassificationPrompt('task', '', 'hints-content');
    expect(prompt).toContain('## Semantic Pre-Candidates');
  });
});
