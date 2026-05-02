import { describe, it, expect } from 'vitest';
import { isUrl, buildWhisperPrompt, VIDEO_EXTENSIONS } from '../../ingest/transcribe.js';

describe('isUrl', () => {
  it('returns true for http:// URLs', () => {
    expect(isUrl('http://example.com/video.mp4')).toBe(true);
  });

  it('returns true for https:// URLs', () => {
    expect(isUrl('https://www.youtube.com/watch?v=abc')).toBe(true);
  });

  it('returns true for www. prefixed strings', () => {
    expect(isUrl('www.youtube.com/watch?v=abc')).toBe(true);
  });

  it('returns false for local file paths', () => {
    expect(isUrl('/path/to/video.mp4')).toBe(false);
    expect(isUrl('./relative/video.mp4')).toBe(false);
    expect(isUrl('video.mp4')).toBe(false);
  });
});

describe('buildWhisperPrompt', () => {
  it('returns fallback prompt for empty labels', () => {
    const prompt = buildWhisperPrompt([]);
    expect(prompt).toContain('punctuation');
  });

  it('includes top 5 labels in the prompt', () => {
    const labels = ['React', 'TypeScript', 'GraphQL', 'Node.js', 'Webpack', 'Babel'];
    const prompt = buildWhisperPrompt(labels);
    expect(prompt).toContain('React');
    expect(prompt).toContain('TypeScript');
    expect(prompt).toContain('GraphQL');
    // 6th label should not appear
    expect(prompt).not.toContain('Babel');
  });

  it('produces a domain hint in the expected format', () => {
    const prompt = buildWhisperPrompt(['Auth', 'JWT']);
    expect(prompt).toMatch(/Technical discussion about Auth, JWT/);
  });
});

describe('VIDEO_EXTENSIONS', () => {
  it('includes common video extensions', () => {
    expect(VIDEO_EXTENSIONS.has('.mp4')).toBe(true);
    expect(VIDEO_EXTENSIONS.has('.mov')).toBe(true);
    expect(VIDEO_EXTENSIONS.has('.webm')).toBe(true);
  });

  it('includes common audio extensions', () => {
    expect(VIDEO_EXTENSIONS.has('.mp3')).toBe(true);
    expect(VIDEO_EXTENSIONS.has('.wav')).toBe(true);
    expect(VIDEO_EXTENSIONS.has('.m4a')).toBe(true);
  });
});
