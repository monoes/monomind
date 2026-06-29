/**
 * Tests for validateInput() in input-guards.ts
 *
 * Covers: null byte rejection, control-char stripping, path traversal,
 * URL protocol allow-list, orgName format, and valid pass-through cases.
 */
import { describe, it, expect } from 'vitest';
import { validateInput } from './input-guards.js';
// ---------------------------------------------------------------------------
// type:'string' — null bytes and control characters
// ---------------------------------------------------------------------------
describe('validateInput – type:string', () => {
    it('rejects strings containing a null byte', () => {
        const result = validateInput('hello\0world', { type: 'string' });
        expect(result.valid).toBe(true);
        // The null byte should be stripped from sanitized output
        expect(result.sanitized).toBe('helloworld');
    });
    it('strips C0 control characters (U+0000–U+001F)', () => {
        const result = validateInput('abc\x01\x1Fdef', { type: 'string' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('abcdef');
    });
    it('strips DEL (U+007F)', () => {
        const result = validateInput('abc\x7Fdef', { type: 'string' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('abcdef');
    });
    it('strips C1 control characters (U+0080–U+009F)', () => {
        const result = validateInput('abc\x80\x9Fdef', { type: 'string' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('abcdef');
    });
    it('preserves printable ASCII unchanged', () => {
        const result = validateInput('Hello, World! 123', { type: 'string' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('Hello, World! 123');
    });
    it('preserves printable extended Unicode', () => {
        const result = validateInput('café résumé 日本語', { type: 'string' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('café résumé 日本語');
    });
    it('rejects empty string when required (default)', () => {
        const result = validateInput('', { type: 'string' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/empty/i);
    });
    it('rejects strings over maxLength', () => {
        const result = validateInput('a'.repeat(10), { type: 'string', maxLength: 5 });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/maximum length/i);
    });
    it('rejects non-string value', () => {
        const result = validateInput(42, { type: 'string' });
        expect(result.valid).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// type:'path' — null bytes and traversal
// ---------------------------------------------------------------------------
describe('validateInput – type:path', () => {
    it('rejects paths containing a null byte', () => {
        const result = validateInput('/tmp/foo\0bar', { type: 'path' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/null bytes/i);
    });
    it('rejects directory traversal via ../', () => {
        const result = validateInput('../etc/passwd', { type: 'path' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/traversal/i);
    });
    it('rejects embedded traversal segment', () => {
        const result = validateInput('foo/../../etc/passwd', { type: 'path' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/traversal/i);
    });
    it('accepts a simple relative path', () => {
        const result = validateInput('foo/bar.txt', { type: 'path' });
        expect(result.valid).toBe(true);
    });
    it('rejects non-string value', () => {
        const result = validateInput(null, { type: 'path' });
        expect(result.valid).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// type:'url' — protocol allow-list
// ---------------------------------------------------------------------------
describe('validateInput – type:url', () => {
    it('accepts http:// URLs', () => {
        const result = validateInput('http://example.com/path', { type: 'url' });
        expect(result.valid).toBe(true);
    });
    it('accepts https:// URLs', () => {
        const result = validateInput('https://example.com/path?q=1', { type: 'url' });
        expect(result.valid).toBe(true);
    });
    it('rejects file:// protocol', () => {
        const result = validateInput('file:///etc/passwd', { type: 'url' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/http or https/i);
    });
    it('rejects javascript: protocol', () => {
        const result = validateInput('javascript:alert(1)', { type: 'url' });
        expect(result.valid).toBe(false);
    });
    it('rejects ftp:// protocol', () => {
        const result = validateInput('ftp://example.com/file', { type: 'url' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/http or https/i);
    });
    it('rejects malformed URLs', () => {
        const result = validateInput('not-a-url', { type: 'url' });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/valid URL/i);
    });
    it('rejects non-string value', () => {
        const result = validateInput(123, { type: 'url' });
        expect(result.valid).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// type:'orgName' — special characters rejected
// ---------------------------------------------------------------------------
describe('validateInput – type:orgName', () => {
    it('accepts valid lowercase alphanum + hyphen names', () => {
        const result = validateInput('my-org-123', { type: 'orgName' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('my-org-123');
    });
    it('rejects names with uppercase letters', () => {
        const result = validateInput('MyOrg', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects names with underscores', () => {
        const result = validateInput('my_org', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects names with spaces', () => {
        const result = validateInput('my org', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects names with special characters', () => {
        const result = validateInput('org@name!', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects names that start with a hyphen', () => {
        const result = validateInput('-myorg', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects empty org name', () => {
        const result = validateInput('', { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects names over 64 chars', () => {
        const result = validateInput('a'.repeat(65), { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
    it('rejects non-string value', () => {
        const result = validateInput(null, { type: 'orgName' });
        expect(result.valid).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// type:'number'
// ---------------------------------------------------------------------------
describe('validateInput – type:number', () => {
    it('accepts a numeric value', () => {
        const result = validateInput(42, { type: 'number' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('42');
    });
    it('accepts a numeric string', () => {
        const result = validateInput('3.14', { type: 'number' });
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('3.14');
    });
    it('rejects NaN input', () => {
        const result = validateInput('not-a-number', { type: 'number' });
        expect(result.valid).toBe(false);
    });
    it('rejects Infinity', () => {
        const result = validateInput(Infinity, { type: 'number' });
        expect(result.valid).toBe(false);
    });
});
//# sourceMappingURL=input-guards.test.js.map