import type { EvasionResult } from '../entities/threat.js';

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic lookalikes (lowercase)
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o',
  'р': 'r', 'с': 'c', 'х': 'x', 'у': 'y',
  // Cyrillic lookalikes (uppercase)
  'А': 'A', 'Е': 'E', 'І': 'I', 'О': 'O',
  'Р': 'R', 'С': 'C', 'Х': 'X', 'У': 'U',
  // Greek lookalikes
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i',
  'ν': 'n', 'ρ': 'r', 'τ': 't',
  // IPA small caps
  'ɪ': 'i', 'ɢ': 'g', 'ɴ': 'n', 'ʀ': 'r', 'ɑ': 'a',
  // Fullwidth ASCII
  'ｉ': 'i', 'ｇ': 'g', 'ｎ': 'n', 'ｏ': 'o',
  'ｒ': 'r', 'ｅ': 'e', 'ａ': 'a', 'ｓ': 's',
};

const LEET_MAP: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '7': 't', '@': 'a', '$': 's',
};

// Pre-built regex from HOMOGLYPHS and LEET_MAP keys for fast bulk replacement
const HOMOGLYPH_REGEX = new RegExp(
  `[${Object.keys(HOMOGLYPHS).join('')}]`, 'g'
);
const LEET_REGEX = new RegExp(
  `[${Object.keys(LEET_MAP).map(k => k.replace(/[$@]/g, '\\$&')).join('')}]`, 'g'
);

// Stateless version (no g-flag) for .test() calls inside expandLeetspeak
const LEET_REGEX_NO_G = new RegExp(
  `[${Object.keys(LEET_MAP).map(k => k.replace(/[$@]/g, '\\$&')).join('')}]`
);

// g flag is required for replace() to replace all occurrences
const ZERO_WIDTH_REGEX = /[​-‏﻿⁠᠎]/g;
// g flag is required for while + exec loop
const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{20,}={0,2}/g;

// Regex to detect presence of any homoglyph/leet char (no g-flag, stateless)
const HAS_HOMOGLYPH_RE = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`);
// Matches a word-boundary token that mixes letters with leet chars (excludes standalone emails/numbers)
const MIXED_LEET_TOKEN_RE = /\b(?=[^@$\r\n]*[a-zA-Z])(?=[^a-zA-Z\r\n]*[@$0-9])[a-zA-Z0-9@$]{2,}\b/;

// Skip expensive transforms on inputs longer than this — real obfuscation payloads
// are short; very large inputs are documents, not injections.
const MAX_EVASION_CHARS = 2000;

export class EvasionDetector {
  normalize(input: string): EvasionResult {
    // For very long inputs, only do cheap NFKC normalization and zero-width stripping
    if (input.length > MAX_EVASION_CHARS) {
      const stripped = input.normalize('NFKC').replace(/[​-‏﻿⁠᠎]/g, '');
      return { normalizedInput: stripped, wasObfuscated: stripped !== input, techniqueDetected: undefined };
    }

    const afterNFKC = input.normalize('NFKC');
    let result = afterNFKC;

    result = this.replaceHomoglyphs(result);
    result = this.expandLeetspeak(result);
    result = this.collapseSpacedChars(result);
    result = this.stripZeroWidth(result);
    result = this.appendDecodedBase64(input, result);

    // Compare normalized result to the clean baseline (NFKC + zero-width stripped, no other transforms)
    const baseline = afterNFKC.replace(/[​-‏﻿⁠᠎]/g, '');
    const wasObfuscated = result !== baseline;

    return {
      normalizedInput: result,
      wasObfuscated,
      techniqueDetected: this.detectTechnique(input),
    };
  }

  private replaceHomoglyphs(input: string): string {
    HOMOGLYPH_REGEX.lastIndex = 0;
    return input.replace(HOMOGLYPH_REGEX, (ch) => HOMOGLYPHS[ch] ?? ch);
  }

  private expandLeetspeak(input: string): string {
    // Only expand leet chars in tokens that mix letters with leet-substitutable chars.
    // Skip tokens that look like email segments (@ followed by word char) to prevent
    // false positives on alice@example.com. Also skip pure-number or pure-letter tokens.
    return input.replace(/\b[\w@$]+\b/g, (token) => {
      const hasLetter = /[a-zA-Z]/.test(token);
      const hasLeet = LEET_REGEX_NO_G.test(token);
      // Treat tokens containing @<word> as email-like — not leet obfuscation
      const isEmailToken = /@\w/.test(token);
      if (!hasLetter || !hasLeet || isEmailToken) return token;
      LEET_REGEX.lastIndex = 0;
      return token.replace(LEET_REGEX, (ch) => LEET_MAP[ch] ?? ch);
    });
  }

  private collapseSpacedChars(input: string): string {
    // "i g n o r e" → "ignore": collapse runs of space-separated single chars
    return input.replace(/(?<!\w)(\w)( \w){2,}(?!\w)/g, (match) => match.replace(/ /g, ''));
  }

  private stripZeroWidth(input: string): string {
    return input.replace(/[​-‏﻿⁠᠎]/g, '');
  }

  private appendDecodedBase64(original: string, current: string): string {
    const decoded: string[] = [];
    let match: RegExpExecArray | null;
    BASE64_BLOB_REGEX.lastIndex = 0;
    while ((match = BASE64_BLOB_REGEX.exec(original)) !== null) {
      try {
        const dec = Buffer.from(match[0], 'base64').toString('utf8');
        if (/[\x20-\x7E]{5,}/.test(dec) && !dec.includes('\x00')) {
          decoded.push(dec);
        }
      } catch {
        // ignore invalid base64
      }
    }
    return decoded.length > 0 ? `${current} ${decoded.join(' ')}` : current;
  }

  private detectTechnique(original: string): EvasionResult['techniqueDetected'] {
    // Reset stateful regex before use
    ZERO_WIDTH_REGEX.lastIndex = 0;
    if (ZERO_WIDTH_REGEX.test(original)) return 'zero_width';
    if (HAS_HOMOGLYPH_RE.test(original)) return 'homoglyph';
    if (MIXED_LEET_TOKEN_RE.test(original)) return 'leetspeak';
    if (/(?<!\w)(\w)( \w){2,}(?!\w)/.test(original)) return 'spacing';
    BASE64_BLOB_REGEX.lastIndex = 0;
    if (BASE64_BLOB_REGEX.test(original)) return 'base64';
    return undefined;
  }
}

export function createEvasionDetector(): EvasionDetector {
  return new EvasionDetector();
}
