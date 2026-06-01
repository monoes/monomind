import { describe, it, expect } from 'vitest';
import { normalizeId, buildNormToIdMap, reconcileEdges } from '../../graph/normalize-id.js';

describe('normalizeId', () => {
  it('lowercases the result', () => {
    expect(normalizeId('FooBar')).toBe('foobar');
  });

  it('replaces non-alphanumeric runs with a single underscore', () => {
    expect(normalizeId('Session_ValidateToken')).toBe('session_validatetoken');
  });

  it('collapses multiple separators', () => {
    expect(normalizeId('My--Class::method')).toBe('my_class_method');
  });

  it('strips leading and trailing underscores', () => {
    expect(normalizeId('_hello_')).toBe('hello');
    expect(normalizeId('__foo__bar__')).toBe('foo_bar');
  });

  it('handles an already-clean id', () => {
    expect(normalizeId('foo_bar_baz')).toBe('foo_bar_baz');
  });

  it('handles an empty string', () => {
    expect(normalizeId('')).toBe('');
  });
});

describe('buildNormToIdMap', () => {
  it('maps normalised form to original id', () => {
    const ids = ['Session_ValidateToken', 'auth_login', 'UserService'];
    const map = buildNormToIdMap(ids);
    expect(map.get('session_validatetoken')).toBe('Session_ValidateToken');
    expect(map.get('auth_login')).toBe('auth_login');
    expect(map.get('userservice')).toBe('UserService');
  });

  it('later entries overwrite earlier ones on collision', () => {
    // Both normalise to 'foo'
    const ids = ['foo', 'FOO'];
    const map = buildNormToIdMap(ids);
    // Last one wins
    expect(map.get('foo')).toBe('FOO');
  });
});

describe('reconcileEdges', () => {
  const nodeIds = new Set(['Session_ValidateToken', 'auth_login', 'UserService']);

  it('keeps edges with exact endpoint match', () => {
    const edges = [{ source: 'Session_ValidateToken', target: 'auth_login' }];
    const result = reconcileEdges(edges, nodeIds);
    expect(result.resolved).toHaveLength(1);
    expect(result.dangling).toHaveLength(0);
    expect(result.remappedCount).toBe(0);
  });

  it('remaps edges via normalisation', () => {
    // LLM generated "session_validatetoken" instead of "Session_ValidateToken"
    const edges = [{ source: 'session_validatetoken', target: 'auth_login' }];
    const result = reconcileEdges(edges, nodeIds);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].source).toBe('Session_ValidateToken');
    expect(result.remappedCount).toBe(1);
  });

  it('moves dangling edges to dangling list', () => {
    const edges = [{ source: 'nonexistent', target: 'auth_login' }];
    const result = reconcileEdges(edges, nodeIds);
    expect(result.resolved).toHaveLength(0);
    expect(result.dangling).toHaveLength(1);
  });

  it('handles empty edge list', () => {
    const result = reconcileEdges([], nodeIds);
    expect(result.resolved).toHaveLength(0);
    expect(result.dangling).toHaveLength(0);
    expect(result.remappedCount).toBe(0);
  });

  it('handles both endpoints requiring normalisation', () => {
    // LLM emits ids with different casing/punctuation than the canonical form
    // 'session_validate_token' -> normalises to 'session_validate_token' -> matches 'Session_Validate_Token'
    // 'user--service' -> normalises to 'user_service' -> matches 'User_Service'
    const edges = [{ source: 'session_validate_token', target: 'user_service' }];
    const ids = new Set(['Session_Validate_Token', 'User_Service']);
    const result = reconcileEdges(edges, ids);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0].source).toBe('Session_Validate_Token');
    expect(result.resolved[0].target).toBe('User_Service');
    expect(result.remappedCount).toBe(1);
  });

  it('preserves extra properties on edges', () => {
    const edges = [{ source: 'auth_login', target: 'UserService', relation: 'CALLS', confidence: 0.9 }];
    const result = reconcileEdges(edges, nodeIds);
    expect(result.resolved[0].relation).toBe('CALLS');
    expect(result.resolved[0].confidence).toBe(0.9);
  });
});
