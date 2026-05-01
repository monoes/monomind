import { describe, it, expect } from 'vitest';
import { classifyFile } from '../../analysis/file-classifier.js';

describe('classifyFile', () => {
  it('classifies TypeScript as CODE', () => {
    expect(classifyFile('src/app.ts')).toBe('CODE');
  });
  it('classifies Python as CODE', () => {
    expect(classifyFile('main.py')).toBe('CODE');
  });
  it('classifies markdown as DOCUMENT', () => {
    expect(classifyFile('README.md')).toBe('DOCUMENT');
  });
  it('classifies PDF as DOCUMENT', () => {
    expect(classifyFile('report.pdf')).toBe('DOCUMENT');
  });
  it('classifies PNG as IMAGE', () => {
    expect(classifyFile('logo.png')).toBe('IMAGE');
  });
  it('classifies mp4 as VIDEO', () => {
    expect(classifyFile('demo.mp4')).toBe('VIDEO');
  });
  it('classifies arxiv URL as PAPER', () => {
    expect(classifyFile('https://arxiv.org/abs/2401.00001')).toBe('PAPER');
  });
  it('returns CODE for unknown extension', () => {
    expect(classifyFile('Makefile')).toBe('CODE');
  });
  it('detects paper signals in filename', () => {
    expect(classifyFile('attention_is_all_you_need.pdf')).toBe('PAPER');
  });
});
