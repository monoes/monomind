/**
 * Per-rule auto-fixers for the monodesign detector.
 *
 * A fixer is pure: it takes file content (plus its extension) and returns a
 * list of precise text edits `{ start, end, replacement, note }` — or an empty
 * list when nothing in this file is safely rewritable. Only rules with a
 * deterministic, idempotent codemod get a fixer; everything else is reported
 * as skipped by the fix loop.
 *
 * Idempotency invariant: every rewrite lands the value on the safe side of
 * the detector's threshold, so re-running a fixer on fixed output produces
 * zero edits (the fix loop's convergence guarantee relies on this).
 */

import {
  extractCssRegions,
  findDeclarations,
  declBlockInfo,
  parseCssValue,
  blockFontSizePx,
  splitTopLevel,
} from './css-regions.mjs';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function withImportant(value, important) {
  return important ? `${value} !important` : value;
}

/** Walk each region and each `prop` declaration, calling cb with full context.
 *  cb may return one edit (region-local offsets) or null. */
function eachDeclaration(content, ext, prop, cb) {
  const edits = [];
  for (const region of extractCssRegions(content, ext)) {
    for (const decl of findDeclarations(region.text, prop)) {
      const block = declBlockInfo(region.text, decl.declStart);
      const selector = block.selector !== null ? block.selector : region.selectorHint;
      const edit = cb({ region, decl, block, selector });
      if (edit) {
        edits.push({
          start: region.start + edit.start,
          end: region.start + edit.end,
          replacement: edit.replacement,
          note: edit.note,
        });
      }
    }
  }
  return edits;
}

/** Edit that removes a whole declaration, including its trailing `;` and any
 *  leading whitespace back to the previous boundary. Region-local offsets. */
function removeDeclaration(text, decl, note) {
  let start = decl.declStart;
  while (start > 0 && /\s/.test(text[start - 1])) start--;
  return { start, end: decl.terminator, replacement: '', note };
}

const LAYOUT_PROP_RE = /^(?:(?:max|min)-)?(?:width|height)$|^padding(?:-(?:top|right|bottom|left))?$|^margin(?:-(?:top|right|bottom|left))?$/i;

const BODY_COPY_TAGS = new Set(['p', 'li', 'blockquote', 'dd']);

/** Does a selector list unambiguously target body copy? Every selector in the
 *  list must qualify — either its final element is a body-copy tag, or it
 *  carries a body-copy class name with no label/heading counter-signal. */
function selectorTargetsBodyCopy(selector) {
  if (!selector) return false;
  const parts = selector.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every(sel => {
    const last = sel.split(/[\s>+~]+/).filter(Boolean).pop() || '';
    if (/^(p|li|blockquote|dd)(?![\w-])/i.test(last)) return true;
    const classes = last.match(/\.[\w-]+/g) || [];
    return classes.some(c =>
      /(body|paragraph|prose|copy|desc|text)/i.test(c) &&
      !/(label|badge|button|nav|heading|title|caps|eyebrow|kicker|tag|chip)/i.test(c));
  });
}

// ---------------------------------------------------------------------------
// Fixers
// ---------------------------------------------------------------------------

/** tight-leading — line-height computing below 1.3x font size → 1.5. */
function fixTightLeading(content, ext) {
  return eachDeclaration(content, ext, 'line-height', ({ decl, block }) => {
    const parsed = parseCssValue(decl.value);
    if (!parsed) return null;
    let ratio = null;
    if (parsed.unit === '' ) ratio = parsed.num;
    else if (parsed.unit === 'em') ratio = parsed.num;
    else if (parsed.unit === '%') ratio = parsed.num / 100;
    else if (parsed.unit === 'px') {
      const fs = blockFontSizePx(block.body);
      if (fs) ratio = parsed.num / fs;
    }
    if (ratio === null || ratio <= 0 || ratio >= 1.3) return null;
    return {
      start: decl.valueStart,
      end: decl.valueEnd,
      replacement: withImportant('1.5', parsed.important),
      note: `line-height ${decl.value} -> 1.5`,
    };
  });
}

/** tiny-text — font-size below 12px → 12px (px / rem only; em is
 *  parent-relative and not statically computable). */
function fixTinyText(content, ext) {
  return eachDeclaration(content, ext, 'font-size', ({ decl }) => {
    const parsed = parseCssValue(decl.value);
    if (!parsed) return null;
    let replacement = null;
    if (parsed.unit === 'px' && parsed.num > 0 && parsed.num < 12) replacement = '12px';
    else if (parsed.unit === 'rem' && parsed.num > 0 && parsed.num < 0.75) replacement = '0.75rem';
    if (!replacement) return null;
    return {
      start: decl.valueStart,
      end: decl.valueEnd,
      replacement: withImportant(replacement, parsed.important),
      note: `font-size ${decl.value} -> ${replacement}`,
    };
  });
}

/** justified-text — text-align: justify without hyphenation → add
 *  `hyphens: auto` in the same declaration block (or rewrite a non-auto
 *  hyphens declaration already present). */
function fixJustifiedText(content, ext) {
  return eachDeclaration(content, ext, 'text-align', ({ region, decl, block }) => {
    if (!/^justify$/i.test(decl.value.replace(/!\s*important/i, '').trim())) return null;
    const hyphens = findDeclarations(block.body, '(?:-webkit-)?hyphens');
    const hasAuto = hyphens.some(h => /^auto$/i.test(h.value.replace(/!\s*important/i, '').trim()));
    if (hasAuto) return null;
    if (hyphens.length > 0) {
      // A hyphens declaration exists but isn't auto — rewrite it.
      const h = hyphens[hyphens.length - 1];
      return {
        start: block.bodyStart + h.valueStart,
        end: block.bodyStart + h.valueEnd,
        replacement: 'auto',
        note: `hyphens ${h.value} -> auto (justified text)`,
      };
    }
    // Insert after the text-align declaration.
    const afterSemi = region.text[decl.terminator - 1] === ';';
    return afterSemi
      ? { start: decl.terminator, end: decl.terminator, replacement: ' hyphens: auto;', note: 'add hyphens: auto next to text-align: justify' }
      : { start: decl.valueEnd, end: decl.valueEnd, replacement: '; hyphens: auto', note: 'add hyphens: auto next to text-align: justify' };
  });
}

/** wide-tracking — letter-spacing above 0.05em on body text → clamp to
 *  0.05em. Skips blocks that set uppercase (the detector exempts uppercase
 *  labels, where wide tracking is legitimate). */
function fixWideTracking(content, ext) {
  return eachDeclaration(content, ext, 'letter-spacing', ({ decl, block }) => {
    if (/text-transform\s*:\s*uppercase/i.test(block.body)) return null;
    const parsed = parseCssValue(decl.value);
    if (!parsed || parsed.num <= 0) return null;
    let em = null;
    if (parsed.unit === 'em') em = parsed.num;
    else if (parsed.unit === 'px' || parsed.unit === 'rem') {
      const fs = blockFontSizePx(block.body);
      if (fs) em = (parsed.unit === 'px' ? parsed.num : parsed.num * 16) / fs;
    }
    if (em === null || em <= 0.05) return null;
    return {
      start: decl.valueStart,
      end: decl.valueEnd,
      replacement: withImportant('0.05em', parsed.important),
      note: `letter-spacing ${decl.value} -> 0.05em`,
    };
  });
}

/** extreme-negative-tracking — letter-spacing at or below -0.05em → clamp to
 *  -0.04em (optical tightening territory, below the detector's floor). */
function fixExtremeNegativeTracking(content, ext) {
  return eachDeclaration(content, ext, 'letter-spacing', ({ decl, block }) => {
    const parsed = parseCssValue(decl.value);
    if (!parsed || parsed.num >= 0) return null;
    let em = null;
    if (parsed.unit === 'em') em = parsed.num;
    else if (parsed.unit === 'px' || parsed.unit === 'rem') {
      const fs = blockFontSizePx(block.body);
      if (fs) em = (parsed.unit === 'px' ? parsed.num : parsed.num * 16) / fs;
    }
    if (em === null || em > -0.05) return null;
    return {
      start: decl.valueStart,
      end: decl.valueEnd,
      replacement: withImportant('-0.04em', parsed.important),
      note: `letter-spacing ${decl.value} -> -0.04em`,
    };
  });
}

/** layout-transition — drop width/height/padding/margin entries from
 *  transition lists (transform/opacity and everything else stay). Removes the
 *  declaration entirely when no entries survive. */
function fixLayoutTransition(content, ext) {
  const edits = [];
  for (const propName of ['transition', 'transition-property']) {
    edits.push(...eachDeclaration(content, ext, propName, ({ region, decl }) => {
      const important = /!\s*important/i.test(decl.value);
      const value = decl.value.replace(/!\s*important/i, '').trim();
      if (/\ball\b/i.test(value)) return null; // detector skips `all` too
      const items = splitTopLevel(value);
      const kept = items.filter(item => {
        const prop = propName === 'transition-property'
          ? item.trim()
          : (item.trim().split(/\s+/)[0] || '');
        return !LAYOUT_PROP_RE.test(prop);
      });
      if (kept.length === items.length) return null;
      if (kept.length === 0) {
        return { ...removeDeclaration(region.text, decl, `remove ${propName} (all entries animated layout)`) };
      }
      return {
        start: decl.valueStart,
        end: decl.valueEnd,
        replacement: withImportant(kept.join(', '), important),
        note: `${propName}: drop layout properties, keep ${kept.join(', ')}`,
      };
    }));
  }
  return edits;
}

/** all-caps-body — remove text-transform: uppercase, but only where the
 *  selector unambiguously targets body copy (or the inline style sits on a
 *  body-copy tag). Anything selector-ambiguous is left for a human. */
function fixAllCapsBody(content, ext) {
  return eachDeclaration(content, ext, 'text-transform', ({ region, decl, block, selector }) => {
    if (!/^uppercase$/i.test(decl.value.replace(/!\s*important/i, '').trim())) return null;
    const qualifies = block.selector !== null
      ? selectorTargetsBodyCopy(selector)
      : BODY_COPY_TAGS.has(region.selectorHint || '');
    if (!qualifies) return null;
    return { ...removeDeclaration(region.text, decl, `remove text-transform: uppercase from ${selector || 'body copy'}`) };
  });
}

/** skipped-heading — demote headings whose level skips past the previous
 *  heading (h1 -> h3 becomes h1 -> h2), walking the document in source order
 *  exactly like the detector does. Only the unambiguous "close the gap"
 *  demotion is applied; open and close tags are rewritten in pairs. */
function fixSkippedHeadings(content, ext) {
  if (!['.html', '.htm', '.vue', '.svelte', '.astro'].includes((ext || '').toLowerCase())) return [];
  const edits = [];
  const tagRe = /<(\/?)h([1-6])\b/gi;
  let prevLevel = 0;
  let pending = null; // { origLevel, newLevel } awaiting the matching close tag
  let m;
  while ((m = tagRe.exec(content)) !== null) {
    const isClose = m[1] === '/';
    const level = parseInt(m[2], 10);
    const digitIdx = m.index + m[0].length - 1;
    if (isClose) {
      if (pending && level === pending.origLevel) {
        edits.push({
          start: digitIdx,
          end: digitIdx + 1,
          replacement: String(pending.newLevel),
          note: `</h${pending.origLevel}> -> </h${pending.newLevel}>`,
        });
        pending = null;
      }
      continue;
    }
    let newLevel = level;
    if (prevLevel > 0 && level > prevLevel + 1) {
      newLevel = prevLevel + 1;
      edits.push({
        start: digitIdx,
        end: digitIdx + 1,
        replacement: String(newLevel),
        note: `<h${level}> -> <h${newLevel}> (closes gap after h${prevLevel})`,
      });
      pending = { origLevel: level, newLevel };
    } else {
      pending = null;
    }
    prevLevel = newLevel;
  }
  return edits;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/**
 * Rules with a deterministic, safe, idempotent codemod.
 * fix(content, ext) -> [{ start, end, replacement, note }]
 */
const FIXERS = {
  'tight-leading': {
    description: 'raise sub-1.3 line-height to 1.5',
    fix: fixTightLeading,
  },
  'tiny-text': {
    description: 'raise sub-12px font-size to the 12px minimum',
    fix: fixTinyText,
  },
  'justified-text': {
    description: 'add hyphens: auto next to text-align: justify',
    fix: fixJustifiedText,
  },
  'wide-tracking': {
    description: 'clamp body-text letter-spacing to 0.05em',
    fix: fixWideTracking,
  },
  'extreme-negative-tracking': {
    description: 'clamp crushed letter-spacing to -0.04em',
    fix: fixExtremeNegativeTracking,
  },
  'layout-transition': {
    description: 'drop width/height/padding/margin from transition lists',
    fix: fixLayoutTransition,
  },
  'all-caps-body': {
    description: 'remove text-transform: uppercase from body-copy selectors',
    fix: fixAllCapsBody,
  },
  'skipped-heading': {
    description: 'demote heading tags to close skipped levels',
    fix: fixSkippedHeadings,
  },
};

/**
 * Rules deliberately without a fixer, with the reason surfaced in reports.
 * broken-image is the canonical example: choosing a real image (or deciding
 * the tag should go) is a content decision — any deterministic rewrite
 * (placeholder URL, removing the tag) would guess at intent, so it is not
 * safely fixable.
 */
const UNFIXABLE_REASONS = {
  'broken-image': 'not safely fixable: supplying a real image (or removing the tag) is a content decision, not a codemod',
  'low-contrast': 'not safely fixable: picking replacement colors is a palette decision',
  'overused-font': 'not safely fixable: choosing a replacement typeface is a brand decision',
  'skipped-heading-ambiguous': 'heading structure too ambiguous to rewrite automatically',
};

function getFixer(ruleId) {
  return FIXERS[ruleId] || null;
}

function fixableRuleIds() {
  return Object.keys(FIXERS);
}

export {
  FIXERS,
  UNFIXABLE_REASONS,
  getFixer,
  fixableRuleIds,
  // exported for direct unit testing
  fixTightLeading,
  fixTinyText,
  fixJustifiedText,
  fixWideTracking,
  fixExtremeNegativeTracking,
  fixLayoutTransition,
  fixAllCapsBody,
  fixSkippedHeadings,
  selectorTargetsBodyCopy,
};
