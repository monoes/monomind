import type { EvasionResult } from '../entities/threat.js';

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic lookalikes (lowercase)
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o',
  'р': 'r', 'с': 'c', 'х': 'x', 'у': 'y',
  'ѕ': 's', 'ԁ': 'd', 'һ': 'h',
  // Cyrillic lookalikes (uppercase)
  'А': 'A', 'Е': 'E', 'І': 'I', 'О': 'O',
  'Р': 'R', 'С': 'C', 'Х': 'X', 'У': 'U',
  // Greek lookalikes
  'ο': 'o', 'α': 'a', 'ε': 'e', 'ι': 'i',
  'ν': 'n', 'ρ': 'r', 'τ': 't', 'Ι': 'I',
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
    // Punctuation-separated obfuscation ("ignore-previous-instructions",
    // "ignore.previous.instructions", "ignore_previous_instructions") must run
    // before pattern matching since the injection regexes join words with
    // \s+ only and never match punctuation-joined variants.
    result = this.normalizePunctuationSeparators(result);
    result = this.collapseSpacedChars(result);
    // Leet expansion runs after space collapsing so that spaced-leet combos like
    // "i g n 0 r e" collapse to "ign0re" first, then "0" → "o" → "ignore".
    result = this.expandLeetspeak(result);
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
      // Treat tokens containing @<word> as email-like — not leet obfuscation.
      // Known tradeoff: @ll ("all") and @ttack ("attack") are also skipped.
      // Accepted: real-world injection payloads use @-substitution only when mixed
      // with other leet chars, so the false-negative risk is low vs. the FP risk.
      const isEmailToken = /@\w/.test(token);
      if (!hasLetter || !hasLeet || isEmailToken) return token;
      LEET_REGEX.lastIndex = 0;
      return token.replace(LEET_REGEX, (ch) => LEET_MAP[ch] ?? ch);
    });
  }

  private normalizePunctuationSeparators(input: string): string {
    // Convert runs of '.', '-', '_' between word characters into a single
    // space, e.g. "ignore-previous-instructions" → "ignore previous
    // instructions". Skips tokens immediately preceded by '@' so email/domain
    // parts like "alice@example.com" are left intact.
    return input.replace(
      /[a-zA-Z0-9]+(?:[._-]+[a-zA-Z0-9]+)+/g,
      (token, offset: number, full: string) => {
        if (full[offset - 1] === '@') return token;
        return token.replace(/[._-]+/g, ' ');
      }
    );
  }

  private collapseSpacedChars(input: string): string {
    // "i g n o r e" → "ignore": collapse runs of space-separated single chars
    return input.replace(/(?<!\w)(\w)( \w){2,}(?!\w)/g, (match) => match.replace(/ /g, ''));
  }

  private stripZeroWidth(input: string): string {
    return input.replace(/[​-‏﻿⁠᠎]/g, '');
  }

  /**
   * Decode `candidate` as base64 and return the decoded text only if it looks
   * like a genuine base64-encoded payload rather than an incidental long
   * alphanumeric run (git SHA, JWT segment, session id, ...):
   *   - length must be divisible by 4 (real padded base64 always satisfies this)
   *   - the decoded bytes must be mostly printable text (>70%), not binary noise
   */
  private decodeIfLikelyBase64(candidate: string): string | null {
    if (candidate.length % 4 !== 0) return null;
    try {
      const dec = Buffer.from(candidate, 'base64').toString('utf8');
      if (dec.length === 0 || dec.includes('\x00')) return null;
      let printable = 0;
      for (let i = 0; i < dec.length; i++) {
        const code = dec.charCodeAt(i);
        if ((code >= 0x20 && code <= 0x7e) || code === 0x09 || code === 0x0a || code === 0x0d) {
          printable++;
        }
      }
      return printable / dec.length > 0.7 ? dec : null;
    } catch {
      return null;
    }
  }

  private appendDecodedBase64(original: string, current: string): string {
    const decoded: string[] = [];
    let match: RegExpExecArray | null;
    BASE64_BLOB_REGEX.lastIndex = 0;
    while ((match = BASE64_BLOB_REGEX.exec(original)) !== null) {
      const dec = this.decodeIfLikelyBase64(match[0]);
      if (dec !== null) decoded.push(dec);
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
    let base64Match: RegExpExecArray | null;
    while ((base64Match = BASE64_BLOB_REGEX.exec(original)) !== null) {
      if (this.decodeIfLikelyBase64(base64Match[0]) !== null) return 'base64';
    }
    return undefined;
  }
}

export function createEvasionDetector(): EvasionDetector {
  return new EvasionDetector();
}
