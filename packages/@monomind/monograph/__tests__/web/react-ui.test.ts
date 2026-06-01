import { describe, it, expect } from 'vitest';
import { getReactUiHtml } from '../../src/web/react-ui.js';

describe('getReactUiHtml', () => {
  it('returns a non-empty HTML string', () => {
    const html = getReactUiHtml();
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(100);
  });

  it('includes DOCTYPE and html tags', () => {
    const html = getReactUiHtml();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes React CDN scripts', () => {
    const html = getReactUiHtml();
    expect(html).toContain('react@18');
    expect(html).toContain('react-dom@18');
  });

  it('includes the root mount point', () => {
    const html = getReactUiHtml();
    expect(html).toContain('id="root"');
  });

  it('includes required UI element ids', () => {
    const html = getReactUiHtml();
    expect(html).toContain('search-input');
    expect(html).toContain('search-btn');
    expect(html).toContain('analyze-btn');
    expect(html).toContain('results');
    expect(html).toContain('progress');
  });

  it('includes Babel standalone for JSX', () => {
    const html = getReactUiHtml();
    expect(html).toContain('babel');
    expect(html).toContain('text/babel');
  });
});
