'use strict';
/**
 * Keyword ranking of catalog items (agents, skills, org roles) against a task.
 * It is the no-model fallback of every picker and builds the Jev candidate
 * shortlist, so jev-picker.cjs requires it and re-exports `shortlist`.
 *
 * Scoring is BM25-style: query words (stopwords dropped, lightly stemmed) are
 * weighted by their rarity across the catalog (IDF), description matches
 * saturate and are normalised by description length (so a long description
 * does not win by sheer size), a word in an item's name or id adds a fixed
 * bonus unless it is a category prefix shared by many ids (`engineering-`,
 * `mastermind-`, ...), and the total is scaled by the share of query words
 * the item matches. An item marked `pick: 'low'` (admin/meta skills, from
 * `pick: low` frontmatter) keeps LOW_PICK_FACTOR of its score, so it surfaces
 * only when the task names it. Equal scores keep catalog order.
 *
 * Exclusions (English only, query side only): words the task explicitly
 * rules out do not count ("anything pending rather than release" must not
 * pick release-manager). withoutExclusions() drops each cue and the words in
 * its scope before tokenizing. Cues: "rather than", "other than", "instead
 * of", "apart from", "aside from", "except", "besides", "excluding",
 * "without", "not", "no", "nor", "don't"/"dont". The scope ends at clause
 * punctuation (. , ; : ! ? brackets, dashes), at "but"/"then"/"so", at
 * "and" once a word was dropped ("or"/"nor" keep excluding: "without CI or
 * staging"), or after SCOPE_WORDS content words. Problem descriptions are not
 * exclusions: "not"/"no" after a copula or auxiliary ("is not loading",
 * "are no tests", "does not"), "not only", and "don't know/see/get/..." stay.
 */

var K1 = 1.2;
var B = 0.75;
// Bonus (in IDF units) for a query word found in the item's name or id.
var STRONG_WEIGHT = 2;
// An id's leading segment shared by this many ids is a category prefix.
var PREFIX_MIN_SHARED = 3;
// Share of its score a `pick: 'low'` item keeps.
var LOW_PICK_FACTOR = 0.35;

var STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any anything are as at be because been before being below ' +
    'between both but by can could did do does doing down during each else etc every everything few for from further had has ' +
    'have having he her here hers him his how i if in into is it its itself just me more most must my no nor ' +
    'not nothing now of off on once only or other our ours out over own per please same she should so some something such than ' +
    'that the their theirs them then there these they this those through to too under until up upon us very ' +
    'via was we were what when where which while who whom why will with within without would you your yours'
  ).split(' '),
);

// Words that name a product family or a role in general, never a skill.
var GENERIC_WORDS = new Set('agent agents mastermind monoswarm monomind specialized specialist expert'.split(' '));

function undouble(s) {
  var n = s.length;
  if (n > 3 && s[n - 1] === s[n - 2] && 'aeioulsz'.indexOf(s[n - 1]) === -1) return s.slice(0, -1);
  return s;
}

function strip(tok, suffix, min) {
  if (tok.length - suffix.length < min || tok.slice(-suffix.length) !== suffix) return null;
  return tok.slice(0, -suffix.length);
}

/** Light stemmer: test/tests/testing/tester/tested all meet at "test",
 *  optimize/optimization/optimizing at "optimiz". Deliberately crude — it
 *  only has to make a word's forms collide, never produce a real word. */
function stem(tok) {
  if (tok.length <= 3 || /^[0-9]/.test(tok)) return tok;
  var s = tok;
  var r;
  // Inflection.
  if ((r = strip(s, 'ies', 2))) s = r + 'y';
  else if ((r = strip(s, 'sses', 2))) s = r + 'ss';
  else if (/(ch|sh|x|z)es$/.test(s) && (r = strip(s, 'es', 3))) s = r;
  else if (s.slice(-1) === 's' && !/(ss|us|is)$/.test(s) && (r = strip(s, 's', 3))) s = r;
  if ((r = strip(s, 'ing', 3))) s = undouble(r);
  else if ((r = strip(s, 'ed', 3))) s = undouble(r);
  // Derivation.
  if ((r = strip(s, 'ation', 3))) s = r;
  else if ((r = strip(s, 'er', 3))) s = undouble(r);
  else if ((r = strip(s, 'e', 3))) s = r;
  return s;
}

// Scripts written without spaces between words: a run of them is indexed as
// overlapping character pairs (安全审计 -> 安全 全审 审计), the usual
// dictionary-free approximation of their words.
var CJK_RUN = /([\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}]+)/u;

function bigrams(run) {
  var chars = Array.from(run);
  if (chars.length < 2) return chars;
  var out = [];
  for (var i = 0; i < chars.length - 1; i++) out.push(chars[i] + chars[i + 1]);
  return out;
}

/** Lowercased letter/digit words of any script. Latin, Greek and Cyrillic
 *  accents are folded (résumé -> resume); CJK runs become bigrams. */
function words(text) {
  var folded = String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .toLowerCase();
  var out = [];
  (folded.match(/[\p{L}\p{N}]+/gu) || []).forEach(function (run) {
    run.split(CJK_RUN).forEach(function (piece, i) {
      if (!piece) return;
      if (i % 2 === 1) out.push.apply(out, bigrams(piece));
      else out.push(piece);
    });
  });
  return out;
}

function isContent(w) {
  return w.length > 1 && !STOPWORDS.has(w);
}

/** Stemmed content words of `text`, stopwords and 1-letter words removed. */
function tokens(text) {
  return words(text).filter(isContent).map(stem);
}

// Content words an exclusion cue rules out at most.
var SCOPE_WORDS = 4;
var CLAUSE_SPLIT = /[.,;:!?()[\]{}<>|\n\r\u2013\u2014]+|\s-+\s/;
var SINGLE_CUES = new Set('except besides excluding without not no nor dont'.split(' '));
var PAIR_CUES = { rather: 'than', other: 'than', instead: 'of', apart: 'from', aside: 'from', don: 't' };
// "is not loading", "are no tests", "does not work": a description, not an exclusion.
var DESCRIBES = new Set(
  ('am is are was were be been being does did has have had can could will would get gets got ' +
    'isn aren wasn weren doesn didn hasn haven hadn won wouldn couldn there').split(' '),
);
// "don't know why the build fails" describes a problem too.
var DONT_DESCRIBES = new Set('know understand see get think remember why how'.split(' '));
var SCOPE_ENDS = new Set('but then so'.split(' '));

/** Words the cue at ws[i] spans (0: no cue there). */
function cueAt(ws, i) {
  var w = ws[i];
  var next = ws[i + 1];
  if (PAIR_CUES[w] && next === PAIR_CUES[w]) {
    if (w === 'don' && DONT_DESCRIBES.has(ws[i + 2])) return 0;
    return 2;
  }
  if (!SINGLE_CUES.has(w)) return 0;
  if ((w === 'dont' || (w === 'not' && ws[i - 1] === 'do')) && DONT_DESCRIBES.has(next)) return 0;
  if ((w === 'not' || w === 'no') && (DESCRIBES.has(ws[i - 1]) || next === 'only')) return 0;
  return 1;
}

/** `text` minus the exclusion cues and the words they rule out (see the file
 *  header), clause breaks kept as ". ". Lowercased; a text without cues keeps
 *  every word. */
function withoutExclusions(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .split(CLAUSE_SPLIT)
    .map(function (clause) {
      var ws = clause.match(/[\p{L}\p{N}]+/gu) || [];
      var out = [];
      var left = 0;
      var dropped = 0;
      for (var i = 0; i < ws.length; i++) {
        var n = cueAt(ws, i);
        if (n) {
          i += n - 1;
          left = SCOPE_WORDS;
          dropped = 0;
          continue;
        }
        var w = ws[i];
        if (left > 0) {
          if (SCOPE_ENDS.has(w) || (w === 'and' && dropped > 0)) left = 0;
          else {
            if (isContent(w)) {
              left--;
              dropped++;
            }
            continue;
          }
        }
        out.push(w);
      }
      return out.join(' ');
    })
    .join('. ');
}

/** tokens() of a task: the words it rules out dropped first. */
function queryTokens(text) {
  return tokens(withoutExclusions(text));
}

/** Leading id segments ("engineering-", "mastermind:", "analysis:") that are
 *  shared by >= PREFIX_MIN_SHARED ids or equal the item's category. */
function categoryPrefixes(items) {
  var counts = new Map();
  items.forEach(function (item) {
    var first = String(item.id).toLowerCase().split(/[-:_/]/)[0];
    counts.set(first, (counts.get(first) || 0) + 1);
  });
  return function isPrefix(item, first) {
    return (counts.get(first) || 0) >= PREFIX_MIN_SHARED || String(item.category || '').toLowerCase() === first;
  };
}

/** Name/id words that identify the item: the id minus a category prefix (kept
 *  when it is the whole id) plus the name, minus family words. */
function strongTerms(item, isPrefix) {
  var segments = String(item.id).toLowerCase().split(/[-:_/]/);
  var idPart = segments.length > 1 && isPrefix(item, segments[0]) ? segments.slice(1) : segments;
  var list = words(idPart.join(' ') + ' ' + (item.name || '')).filter(function (w) {
    return isContent(w) && !GENERIC_WORDS.has(w);
  });
  return new Set(list.map(stem));
}

function termCounts(list) {
  var m = new Map();
  list.forEach(function (t) {
    m.set(t, (m.get(t) || 0) + 1);
  });
  return m;
}

/** Per-catalog index: strong/weak term maps, lengths and document frequency. */
function indexFor(items) {
  var isPrefix = categoryPrefixes(items);
  var df = new Map();
  var total = 0;
  var docs = items.map(function (item) {
    var strong = strongTerms(item, isPrefix);
    var weakList = tokens((item.description || '') + ' ' + (item.text || ''));
    var weak = termCounts(weakList);
    new Set(Array.from(strong).concat(Array.from(weak.keys()))).forEach(function (t) {
      df.set(t, (df.get(t) || 0) + 1);
    });
    total += weakList.length;
    return { strong: strong, weak: weak, len: weakList.length, low: item.pick === 'low' };
  });
  return { size: items.length, docs: docs, df: df, avg: total / items.length || 1 };
}

function idf(index, term) {
  var n = index.df.get(term) || 0;
  return Math.log(1 + (index.size - n + 0.5) / (n + 0.5));
}

function scoreDoc(index, doc, query) {
  var score = 0;
  var matched = 0;
  for (var i = 0; i < query.length; i++) {
    var t = query[i];
    var tf = doc.weak.get(t) || 0;
    var hit = doc.strong.has(t) ? STRONG_WEIGHT : 0;
    if (tf) hit += (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / index.avg));
    if (hit) {
      score += idf(index, t) * hit;
      matched++;
    }
  }
  // Coordination: an item matching more of the task's words ranks higher.
  if (query.length) score *= matched / query.length;
  if (doc.low) score *= LOW_PICK_FACTOR;
  return Math.round(score * 1000) / 1000;
}

/** Items ranked by keyword relevance to `query`, forced `include` ids first,
 *  capped at `limit`. Each returned item is a copy with a `score` (0 = no
 *  overlap). Equal scores keep catalog order. */
function shortlist(query, items, limit, include) {
  var index = indexFor(items);
  var q = Array.from(new Set(queryTokens(query)));
  var scored = items.map(function (item, i) {
    return { item: item, index: i, score: scoreDoc(index, index.docs[i], q) };
  });
  scored.sort(function (a, b) {
    return b.score - a.score || a.index - b.index;
  });
  var out = [];
  var seen = new Set();
  function take(entry) {
    if (seen.has(entry.item.id) || out.length >= limit) return;
    seen.add(entry.item.id);
    out.push(Object.assign({}, entry.item, { score: entry.score }));
  }
  (include || []).forEach(function (id) {
    var hit = scored.find(function (s) {
      return s.item.id === id;
    });
    if (hit) take(hit);
  });
  scored.forEach(take);
  return out;
}

module.exports = {
  stem: stem,
  tokens: tokens,
  queryTokens: queryTokens,
  withoutExclusions: withoutExclusions,
  shortlist: shortlist,
};
