import type { SourceToken, TokenKind } from './token-types.js';

export type DetectionMode = 'Exact' | 'NormalizeIdentifiers' | 'NormalizeLiterals' | 'NormalizeAll';

export interface ResolvedNormalization {
  normalizeIdentifiers: boolean;
  normalizeLiterals: boolean;
  normalizeKeywords: boolean;
}

export interface HashedToken {
  hash: number;
  originalIndex: number;
}

export function resolveNormalization(mode: DetectionMode): ResolvedNormalization {
  switch (mode) {
    case 'Exact':
      return { normalizeIdentifiers: false, normalizeLiterals: false, normalizeKeywords: false };
    case 'NormalizeIdentifiers':
      return { normalizeIdentifiers: true, normalizeLiterals: false, normalizeKeywords: false };
    case 'NormalizeLiterals':
      return { normalizeIdentifiers: false, normalizeLiterals: true, normalizeKeywords: false };
    case 'NormalizeAll':
      return { normalizeIdentifiers: true, normalizeLiterals: true, normalizeKeywords: true };
  }
}

export function normalizeAndHash(tokens: SourceToken[], mode: DetectionMode): HashedToken[] {
  return normalizeAndHashResolved(tokens, resolveNormalization(mode));
}

export function normalizeAndHashResolved(tokens: SourceToken[], norm: ResolvedNormalization): HashedToken[] {
  return tokens.map((tok, i) => ({
    hash: hashTokenResolved(tok.kind, norm),
    originalIndex: i,
  }));
}

export function hashTokenResolved(kind: TokenKind, norm: ResolvedNormalization): number {
  if (norm.normalizeIdentifiers && kind.kind === 'Identifier') return djb2('__ID__');
  if (norm.normalizeLiterals) {
    if (kind.kind === 'StringLiteral') return djb2('__STR__');
    if (kind.kind === 'NumericLiteral') return djb2('__NUM__');
    if (kind.kind === 'TemplateLiteral') return djb2('__TPL__');
  }
  if (norm.normalizeKeywords && kind.kind === 'Keyword') return djb2('__KW__');
  return djb2(JSON.stringify(kind));
}

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return h;
}
