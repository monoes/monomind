import type { EvasionResult } from '../entities/threat.js';

const HOMOGLYPHS: Record<string, string> = {
  // Cyrillic lookalikes
  'а': 'a', 'е': 'e', 'і': 'i', 'о': 'o',
  'р': 'r', 'с': 'c', 'х': 'x', 'у': 'y',
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

// g flag is required for replace() to replace all occurrences
const ZERO_WIDTH_REGEX = /[​-‏﻿⁠᠎]/g;
// g flag is required for while + exec loop
const BASE64_BLOB_REGEX = /[A-Za-z0-9+/]{20,}={0,2}/g;

export class EvasionDetector {
  normalize(input: string): EvasionResult {
    const afterNFKC = input.normalize('NFKC');
    let result = afterNFKC;

    result = this.replaceHomoglyphs(result);
    result = this.expandLeetspeak(result);
    result = this.collapseSpacedChars(result);
    result = this.stripZeroWidth(result);
    result = this.appendDecodedBase64(input, result);

    // Compare normalized result to the clean baseline (NFKC + zero-width stripped, no other transforms)
    const baseline = input.normalize('NFKC').replace(ZERO_WIDTH_REGEX, '');
    const wasObfuscated = result !== baseline;

    return {
      normalizedInput: result,
      wasObfuscated,
      techniqueDetected: this.detectTechnique(input),
    };
  }

  private replaceHomoglyphs(input: string): string {
    return input.split('').map(ch => HOMOGLYPHS[ch] ?? ch).join('');
  }

  private expandLeetspeak(input: string): string {
    return input.split('').map(ch => LEET_MAP[ch] ?? ch).join('');
  }

  private collapseSpacedChars(input: string): string {
    // "i g n o r e" → "ignore": collapse runs of space-separated single chars
    return input.replace(/(?<!\w)(\w)( \w){2,}(?!\w)/g, (match) => match.replace(/ /g, ''));
  }

  private stripZeroWidth(input: string): string {
    return input.replace(ZERO_WIDTH_REGEX, '');
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
    if (original.split('').some(ch => ch in HOMOGLYPHS)) return 'homoglyph';
    if (original.split('').some(ch => ch in LEET_MAP)) return 'leetspeak';
    if (/(?<!\w)(\w)( \w){2,}(?!\w)/.test(original)) return 'spacing';
    BASE64_BLOB_REGEX.lastIndex = 0;
    if (BASE64_BLOB_REGEX.test(original)) return 'base64';
    return undefined;
  }
}

export function createEvasionDetector(): EvasionDetector {
  return new EvasionDetector();
}
