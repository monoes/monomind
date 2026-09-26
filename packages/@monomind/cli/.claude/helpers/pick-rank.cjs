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
 * The task's head outweighs its modifiers (English only): in "write developer
 * documentation for the REST API" or "create a new org that monitors
 * competitors" the words after "for" / "that" say what the work is about, not
 * what it is, and count MODIFIER_WEIGHT (queryTerms). On the catalog side, a
 * description opening shared by a large share of the catalog ("Use when an
 * org role acts as ...") is template and is not indexed, and an id word that
 * joins two other id words ("createorg") names both.
 *
 * Exclusions in the task (English only): words the task explicitly
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
 *
 * Exclusions on the document side (English only): a description's own
 * "not for X" / "never for X" / "do not use for X" clause names work the item
 * is NOT for. Its words leave the item's index unless the rest of the
 * description uses them too, so "Not for pull requests" no longer matches
 * "pull request". A task that names what a "not for" clause rules out (more
 * than half the words of one of its alternatives, at least one of them a word
 * the item does not otherwise carry) keeps EXCLUDED_FACTOR of its score.
 */

var K1 = 1.2;
var B = 0.75;
// Bonus (in IDF units) for a query word found in the item's name or id.
var STRONG_WEIGHT = 2;
// An id's leading segment shared by this many ids is a category prefix.
var PREFIX_MIN_SHARED = 3;
// Share of its score a `pick: 'low'` item keeps.
var LOW_PICK_FACTOR = 0.35;
// Share of its score an item keeps when the task names what it is not for.
var EXCLUDED_FACTOR = 0.2;

var STOPWORDS = new Set(
  (
    'a about above after again against all also am an and any anything are as at be because been before being below ' +
    'between both but by can could did do does doing down during each else etc every everything few for from further had has ' +
    'have having he her here hers him his how i if in into is it its itself just me more most must my no nor ' +
    'new not nothing now of off on once only or other our ours out over own per please same she should so some something such than ' +
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

// Weight of a word in a modifier of the task's head (see queryTerms).
var MODIFIER_WEIGHT = 0.5;
var MODIFIER_ENDS = new Set('and then but also'.split(' '));
var RELATIVES = new Set('that which who'.split(' '));

/** A task's query terms as a Map of stemmed word -> weight. Words of the
 *  head (what the task asks for: "write developer documentation", "create a
 *  new org") weigh 1; words in a modifier of it weigh MODIFIER_WEIGHT: a
 *  purpose phrase ("for the REST API") after a head word, or a relative
 *  clause ("that monitors competitors") after a head of two or more words
 *  ending in a content word ("fix that bug" has no relative clause). A
 *  modifier ends at a clause break or "and"/"then"/"but"/"also". */
function queryTerms(text) {
  var terms = new Map();
  withoutExclusions(text)
    .split('. ')
    .forEach(function (clause) {
      var ws = words(clause);
      var head = 0;
      var inModifier = false;
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        if (inModifier && MODIFIER_ENDS.has(w)) inModifier = false;
        else if (!inModifier && head > 0 && (w === 'for' || (RELATIVES.has(w) && head > 1 && isContent(ws[i - 1]))))
          inModifier = true;
        if (!isContent(w)) continue;
        if (!inModifier) head++;
        var t = stem(w);
        var weight = inModifier ? MODIFIER_WEIGHT : 1;
        if (!(terms.get(t) >= weight)) terms.set(t, weight);
      }
    });
  return terms;
}

// A description clause: sentence punctuation, brackets or dashes end it.
var DOC_CLAUSE_SPLIT = /[.;:!?()[\]{}<>|\n\r\u2013\u2014]+|\s-+\s/;
var DOC_NOT_FOR = /\b(?:not|never)\s+(?:intended\s+|meant\s+)?for\s+(.+)$|\b(?:do\s+not|don't|dont|never)\s+use\s+(?:it\s+|this\s+)?for\s+(.+)$/;
var DOC_ALTERNATIVES = /,|\s(?:or|and|nor)\s/;

/** A description's own exclusions (see the file header): `kept` is the text
 *  without its "not for" clauses, `ruledOut` the word lists of each
 *  alternative a "not for" clause names, `dropped` every word those clauses
 *  hold. */
function docExclusions(description) {
  var kept = [];
  var ruledOut = [];
  var dropped = [];
  String(description || '')
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .split(DOC_CLAUSE_SPLIT)
    .forEach(function (clause) {
      var m = DOC_NOT_FOR.exec(clause);
      if (m) {
        kept.push(clause.slice(0, m.index));
        (m[1] || m[2]).split(DOC_ALTERNATIVES).forEach(function (alt) {
          var t = tokens(alt);
          if (t.length) ruledOut.push(t);
        });
        dropped.push(m[1] || m[2]);
        return;
      }
      kept.push(clause);
    });
  return { kept: kept.join(' . '), ruledOut: ruledOut, dropped: new Set(tokens(dropped.join(' '))) };
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
function strongTerms(item, isPrefix, joined) {
  var segments = String(item.id).toLowerCase().split(/[-:_/]/);
  var idPart = segments.length > 1 && isPrefix(item, segments[0]) ? segments.slice(1) : segments;
  var list = words(idPart.join(' ') + ' ' + (item.name || '')).filter(function (w) {
    return isContent(w) && !GENERIC_WORDS.has(w);
  });
  idPart.forEach(function (seg) {
    if (joined.has(seg)) list.push.apply(list, joined.get(seg));
  });
  return new Set(list.map(stem));
}

// Shortest part of a compound id segment (see compoundSegments).
var COMPOUND_MIN_PART = 3;

/** Id segments that join two other id segments ("createorg" = "create" +
 *  "org", "devops" = "dev" + "ops"), mapped to their parts: such an id names
 *  both words. */
function compoundSegments(items) {
  var segs = new Set();
  items.forEach(function (item) {
    String(item.id).toLowerCase().split(/[-:_/]/).forEach(function (seg) { segs.add(seg); });
  });
  var joined = new Map();
  segs.forEach(function (seg) {
    for (var j = COMPOUND_MIN_PART; j <= seg.length - COMPOUND_MIN_PART; j++) {
      var a = seg.slice(0, j);
      var b = seg.slice(j);
      if (segs.has(a) && segs.has(b)) {
        joined.set(seg, [a, b]);
        return;
      }
    }
  });
  return joined;
}

function termCounts(list) {
  var m = new Map();
  list.forEach(function (t) {
    m.set(t, (m.get(t) || 0) + 1);
  });
  return m;
}

// A description opening of this many words or more, shared by this share of
// the catalog, is a template ("Use when an org role acts as ..."), not content.
var TEMPLATE_MIN_WORDS = 4;
var TEMPLATE_MIN_SHARE = 0.05;
var TEMPLATE_MAX_WORDS = 8;

/** Each description minus the longest template opening it starts with: words
 *  that open a large share of the catalog's descriptions say nothing about
 *  one item, and their document frequency would sink the IDF of those words
 *  where they do matter ("org" for the org-management skills). */
function withoutTemplates(items) {
  var descs = items.map(function (item) { return String(item.description || ''); });
  var lists = descs.map(function (d) { return d.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []; });
  var counts = new Map();
  lists.forEach(function (ws) {
    for (var n = TEMPLATE_MIN_WORDS; n <= Math.min(TEMPLATE_MAX_WORDS, ws.length - 1); n++) {
      var key = ws.slice(0, n).join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  var min = Math.max(PREFIX_MIN_SHARED, items.length * TEMPLATE_MIN_SHARE);
  return descs.map(function (d, i) {
    var ws = lists[i];
    for (var n = Math.min(TEMPLATE_MAX_WORDS, ws.length - 1); n >= TEMPLATE_MIN_WORDS; n--) {
      if ((counts.get(ws.slice(0, n).join(' ')) || 0) < min) continue;
      var re = /[\p{L}\p{N}]+/gu;
      for (var k = 0; k < n; k++) re.exec(d);
      return d.slice(re.lastIndex);
    }
    return d;
  });
}

/** Per-catalog index: strong/weak term maps, lengths and document frequency. */
function indexFor(items) {
  var isPrefix = categoryPrefixes(items);
  var joined = compoundSegments(items);
  var descriptions = withoutTemplates(items);
  var df = new Map();
  var total = 0;
  var docs = items.map(function (item, i) {
    var strong = strongTerms(item, isPrefix, joined);
    var ex = docExclusions(descriptions[i]);
    var keptList = tokens(ex.kept);
    var own = new Set(keptList);
    // `text` repeats description words (derived keywords): a word only an
    // exclusion clause holds leaves it too.
    var weakList = keptList.concat(tokens(item.text || '').filter(function (t) {
      return own.has(t) || !ex.dropped.has(t);
    }));
    var weak = termCounts(weakList);
    new Set(Array.from(strong).concat(Array.from(weak.keys()))).forEach(function (t) {
      df.set(t, (df.get(t) || 0) + 1);
    });
    total += weakList.length;
    // Each "not for" alternative, with the words it names beyond the item's own.
    var ruledOut = ex.ruledOut
      .map(function (alt) {
        return { all: alt, own: alt.filter(function (t) { return strong.has(t) || weak.has(t); }) };
      })
      .filter(function (alt) { return alt.own.length < alt.all.length; });
    return { strong: strong, weak: weak, len: weakList.length, low: item.pick === 'low', ruledOut: ruledOut };
  });
  return { size: items.length, docs: docs, df: df, avg: total / items.length || 1 };
}

function idf(index, term) {
  var n = index.df.get(term) || 0;
  return Math.log(1 + (index.size - n + 0.5) / (n + 0.5));
}

/** True when the task names more than half of the words of one of the
 *  item's "not for" alternatives, one of them a word the item does not
 *  otherwise carry. */
function namesRuledOut(doc, query) {
  return doc.ruledOut.some(function (alt) {
    var hits = alt.all.filter(function (t) { return query.indexOf(t) !== -1; });
    return hits.length * 2 > alt.all.length && hits.some(function (t) { return alt.own.indexOf(t) === -1; });
  });
}

function scoreDoc(index, doc, query, weights) {
  var score = 0;
  var matched = 0;
  for (var i = 0; i < query.length; i++) {
    var t = query[i];
    var w = weights.get(t);
    var tf = doc.weak.get(t) || 0;
    var hit = doc.strong.has(t) ? STRONG_WEIGHT : 0;
    if (tf) hit += (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.len) / index.avg));
    if (hit) {
      score += idf(index, t) * hit * w;
      matched++;
    }
  }
  // Coordination: an item matching more of the task's words ranks higher.
  if (query.length) score *= matched / query.length;
  if (doc.low) score *= LOW_PICK_FACTOR;
  if (namesRuledOut(doc, query)) score *= EXCLUDED_FACTOR;
  return Math.round(score * 1000) / 1000;
}

/** Items ranked by keyword relevance to `query`, forced `include` ids first,
 *  capped at `limit`. Each returned item is a copy with a `score` (0 = no
 *  overlap). Equal scores keep catalog order. */
function shortlist(query, items, limit, include) {
  var index = indexFor(items);
  var weights = queryTerms(query);
  var q = Array.from(weights.keys());
  var scored = items.map(function (item, i) {
    return { item: item, index: i, score: scoreDoc(index, index.docs[i], q, weights) };
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

// The bar a keyword pick must clear before anything acts on it (the prompt
// hook's [PICK] line, `pick`'s summary and `confident` flag): a minimum
// relevance AND a lead over the runner-up. Ties and weak overlap are no
// decision — a wrong pick in Claude's context costs more than none. Agents
// were tuned on the 40-task pick benchmark (25/40 shown, 23 correct), skills
// on tests/pick-eval (59 tasks, 514 skills: 34 shown, 31 correct).
var KEYWORD_GATE = {
  agents: { min: 2, lead: 1.5 },
  skills: { min: 3, lead: 1.25 },
};

/** The top of a ranked list when it clears `min` and leads the runner-up by
 *  `ratio`, else null. The floor is on keyword relevance alone (`baseScore`
 *  when an outcome prior re-ranked). */
function leads(list, min, ratio) {
  var top = list && list[0];
  if (!top || !((top.baseScore !== undefined ? top.baseScore : top.score) >= min)) return null;
  var second = list[1];
  if (!second || !(second.score > 0)) return top;
  return top.score >= second.score * (ratio || 1) && top.score > second.score ? top : null;
}

module.exports = {
  KEYWORD_GATE: KEYWORD_GATE,
  leads: leads,
  stem: stem,
  tokens: tokens,
  queryTokens: queryTokens,
  queryTerms: queryTerms,
  withoutExclusions: withoutExclusions,
  docExclusions: docExclusions,
  shortlist: shortlist,
};
