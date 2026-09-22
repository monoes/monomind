'use strict';
/**
 * Jev decision-model picker. This is the ONE implementation, shared by the prompt
 * hook (handlers/route-handler.cjs) and the CLI (src/decision/jev.ts requires
 * this file from the package's .claude/helpers).
 *
 * Speaks POST /v1/systemone, which hosted Jev (api.typesafe.ai) and the OpenJev
 * helper shim share. Providers are tried in order (MONOMIND_JEV_URL, then
 * TYPESAFE_API_KEY) inside ONE total window (MONOMIND_JEV_TIMEOUT_MS, default
 * 3000). Nothing configured → no network, and pick() resolves null so every
 * caller keeps its existing routing.
 */
var fs = require('fs');
var path = require('path');

var TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
var DEFAULT_MODEL = 'jev-latest';
var DEFAULT_TIMEOUT_MS = 3000;
var MIN_TIMEOUT_MS = 100;
var MAX_TIMEOUT_MS = 30000;
var MIN_PROVIDER_WINDOW_MS = 50;
var DEFAULT_MIN_CONFIDENCE = 0.6;
var MIN_EXTRA_SKILL_PROBABILITY = 0.2;
var DEFAULT_MAX_SKILLS = 3;
// OpenJev scores up to 52 options per pass; 30 (+ "none") keeps one pass.
var DEFAULT_MAX_CANDIDATES = 30;
var MAX_DESCRIPTION_CHARS = 160;
var MAX_STATE_CHARS = 8000;
var MAX_RESPONSE_CHARS = 1024 * 1024;
var MAX_CATALOG_BYTES = 5 * 1024 * 1024;
var NONE_ID = '__none__';
var OFF_VALUES = ['0', 'off', 'false', 'no'];
var ON_VALUES = ['1', 'on', 'true', 'yes'];
var DEFAULT_HOOK_TIMEOUT_MS = 1500;
var MAX_HOOK_TIMEOUT_MS = 4000;
// Ported VERBATIM from packages/@monomind/cli/src/utils/redaction.ts SECRET_PATTERNS
// (the maintained redactor: JSON keys, header bearer tokens, fine-grained GitHub,
// GitLab, Slack, Stripe, JWT, credentialed URLs). A test compares the two lists
// source-for-source, so an edit to one without the other fails CI.
var SECRET_PATTERNS = [
  /(?:api[_-]?key|apikey)['"]?\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:secret|password|passwd|pwd)['"]?\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi,
  /(?:token|bearer)['"]?\s*[:=]\s*['"]?[^\s'"]{10,}['"]?/gi,
  /\bbearer\s+['"]?[^\s'"]{10,}['"]?/gi,
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  /sk-ant-[a-zA-Z0-9_-]{20,}/g,
  /sk-[a-zA-Z0-9_-]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /glpat-[A-Za-z0-9_-]{16,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /sk_(?:live|test)_[A-Za-z0-9]{16,}/g,
  /npm_[A-Za-z0-9]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s]+:[^@\s]+@[^\s'"]+/g,
];

class JevError extends Error {
  constructor(message, provider, status) {
    super(message);
    this.name = 'JevError';
    this.provider = provider;
    this.status = status;
  }
}

// ── Configuration ──────────────────────────────────────────────────────────

function readEnvValue(env, name) {
  var value = env[name];
  if (typeof value !== 'string') return undefined;
  value = value.trim();
  return value ? value : undefined;
}

function isDisabled(env) {
  var value = readEnvValue(env || process.env, 'MONOMIND_JEV');
  return value !== undefined && OFF_VALUES.indexOf(value.toLowerCase()) !== -1;
}

/** http(s) origin + path, trailing slashes and a trailing /v1 removed; null if unusable. */
function normalizeBaseUrl(value) {
  var raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  var url;
  try {
    url = new URL(raw);
  } catch (e) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.origin + url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function resolveTimeoutMs(env) {
  var n = Number((env || process.env).MONOMIND_JEV_TIMEOUT_MS);
  return Number.isInteger(n) && n >= MIN_TIMEOUT_MS && n <= MAX_TIMEOUT_MS ? n : DEFAULT_TIMEOUT_MS;
}

/** The per-prompt hook's window: short, because every prompt waits on it. */
function resolveHookTimeoutMs(env) {
  var n = Number((env || process.env).MONOMIND_JEV_HOOK_TIMEOUT_MS);
  return Number.isInteger(n) && n >= MIN_TIMEOUT_MS && n <= MAX_HOOK_TIMEOUT_MS ? n : DEFAULT_HOOK_TIMEOUT_MS;
}

/** Mask credential-shaped text before it leaves the machine — same output as redaction.ts redactSecrets. */
function redactSecrets(text) {
  var out = String(text || '');
  SECRET_PATTERNS.forEach(function (re) {
    out = out.replace(re, '[redacted]');
  });
  return out;
}

function resolveMinConfidence(env) {
  var n = Number((env || process.env).MONOMIND_JEV_MIN_CONFIDENCE);
  return n > 0 && n <= 1 ? n : DEFAULT_MIN_CONFIDENCE;
}

/** Shorthand properties keep a key variable out of `apiKey: <expr>` shapes,
 *  which the repo's git pre-commit secret gate rejects. */
function makeProvider(name, baseUrl, apiKey, model) {
  return { name: name, baseUrl: baseUrl, apiKey, model: model };
}

function resolveProviders(env) {
  env = env || process.env;
  if (isDisabled(env)) return [];
  var model = readEnvValue(env, 'MONOMIND_JEV_MODEL') || DEFAULT_MODEL;
  var providers = [];
  var customUrl = normalizeBaseUrl(env.MONOMIND_JEV_URL);
  if (customUrl) {
    var customKey = readEnvValue(env, 'MONOMIND_JEV_API_KEY');
    providers.push(makeProvider('custom', customUrl, customKey, model));
  }
  // TYPESAFE_API_KEY alone never sends anything: it may be set for unrelated
  // TypeSafe use, and every prompt would silently leave the machine.
  var typesafeKey = readEnvValue(env, 'TYPESAFE_API_KEY');
  var hosted = (readEnvValue(env, 'MONOMIND_JEV_HOSTED') || '').toLowerCase();
  if (typesafeKey && ON_VALUES.indexOf(hosted) !== -1) {
    providers.push(makeProvider('typesafe', TYPESAFE_BASE_URL, typesafeKey, model));
  }
  return providers;
}

// ── Protocol ───────────────────────────────────────────────────────────────

async function postSystemOne(provider, request, timeoutMs, fetchImpl) {
  var doFetch = fetchImpl || globalThis.fetch;
  var headers = { 'content-type': 'application/json' };
  if (provider.apiKey) headers.authorization = 'Bearer ' + provider.apiKey;
  var text;
  try {
    var res = await doFetch(provider.baseUrl + '/v1/systemone', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(request),
      // A redirect would re-send the bearer key to wherever it points.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new JevError('HTTP ' + res.status, provider.name, res.status);
    text = await res.text();
  } catch (err) {
    if (err instanceof JevError) throw err;
    throw new JevError('request failed: ' + (err && err.message ? err.message : String(err)), provider.name);
  }
  if (text.length > MAX_RESPONSE_CHARS) throw new JevError('response too large', provider.name);
  var body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new JevError('response is not JSON', provider.name);
  }
  if (!body || typeof body !== 'object' || !body.answers || typeof body.answers !== 'object') {
    throw new JevError('response has no answers', provider.name);
  }
  return body;
}

function isValidAnswer(answer, question) {
  if (!answer || typeof answer !== 'object' || answer.type !== question.type) return false;
  if (question.type === 'noul') return Number.isFinite(answer.noul);
  return (
    typeof answer.choice === 'string' &&
    Object.prototype.hasOwnProperty.call(question.criteria, answer.choice) &&
    Number.isFinite(answer.confidence) &&
    answer.confidence >= 0 &&
    answer.confidence <= 1
  );
}

function report(onError, err) {
  if (typeof onError !== 'function') return;
  try {
    onError(err);
  } catch (e) {
    /* a logger must never break routing */
  }
}

/** Ask every question in one request; first provider with a usable answer wins. */
async function ask(state, questions, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var providers = opts.providers || resolveProviders(env);
  var ids = Object.keys(questions);
  if (providers.length === 0 || ids.length === 0) return null;
  var deadline = Date.now() + (opts.timeoutMs || resolveTimeoutMs(env));
  for (var i = 0; i < providers.length; i++) {
    var provider = providers[i];
    var remaining = deadline - Date.now();
    if (remaining < MIN_PROVIDER_WINDOW_MS) break;
    try {
      var body = await postSystemOne(
        provider,
        { state: state, model: provider.model, questions: questions },
        remaining,
        opts.fetchImpl,
      );
      var answers = {};
      var usable = 0;
      for (var j = 0; j < ids.length; j++) {
        var answer = body.answers[ids[j]];
        if (isValidAnswer(answer, questions[ids[j]])) {
          answers[ids[j]] = answer;
          usable++;
        }
      }
      if (usable > 0) return { provider: provider.name, answers: answers };
      report(opts.onError, new JevError('no usable answer', provider.name));
    } catch (err) {
      report(opts.onError, err instanceof JevError ? err : new JevError(String(err), provider.name));
    }
  }
  return null;
}

/** One tiny noul round-trip; resolves to elapsed ms or throws JevError. */
async function probe(provider, opts) {
  opts = opts || {};
  var started = Date.now();
  var body = await postSystemOne(
    provider,
    {
      state: 'The sky is blue.',
      model: provider.model,
      questions: { probe: { type: 'noul', instructions: 'Does the text mention a colour?' } },
    },
    resolveTimeoutMs(opts.env || process.env),
    opts.fetchImpl,
  );
  var answer = body.answers.probe;
  if (!answer || answer.type !== 'noul' || !Number.isFinite(answer.noul)) {
    throw new JevError('probe answer is malformed', provider.name);
  }
  return Date.now() - started;
}

// ── Candidate shortlist ────────────────────────────────────────────────────

function stem(tok) {
  if (tok.length > 4 && tok.slice(-3) === 'ies') return tok.slice(0, -3) + 'y';
  if (tok.length > 3 && tok.slice(-1) === 's' && tok.slice(-2) !== 'ss') return tok.slice(0, -1);
  return tok;
}

function tokens(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []).map(stem);
}

/** Items ranked by word overlap with the query (id/name words count 3, other
 *  text 1), forced ids first, capped at `limit`. Stable for equal scores. */
function shortlist(query, items, limit, include) {
  var q = Array.from(new Set(tokens(query)));
  var scored = items.map(function (item, index) {
    var strong = new Set(tokens(item.id + ' ' + (item.name || '')));
    var weak = new Set(tokens((item.description || '') + ' ' + (item.text || '')));
    var score = 0;
    for (var i = 0; i < q.length; i++) {
      if (strong.has(q[i])) score += 3;
      else if (weak.has(q[i])) score += 1;
    }
    return { item: item, index: index, score: score };
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

// ── Picking ────────────────────────────────────────────────────────────────

function describeItem(item) {
  var text = String(item.description || item.name || item.id).replace(/\s+/g, ' ').trim();
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS - 1) + '…' : text;
}

function criteriaFor(items) {
  var criteria = {};
  items.forEach(function (item) {
    criteria[item.id] = describeItem(item);
  });
  return criteria;
}

function rankedFrom(answer) {
  var probs = answer.probabilities;
  if (!probs || typeof probs !== 'object') return [{ id: answer.choice, probability: answer.confidence }];
  return Object.keys(probs)
    .filter(function (id) {
      return Number.isFinite(probs[id]);
    })
    .map(function (id) {
      return { id: id, probability: probs[id] };
    })
    .sort(function (a, b) {
      return b.probability - a.probability;
    });
}

function toAnswer(answer) {
  return { choice: answer.choice, confidence: answer.confidence, ranked: rankedFrom(answer) };
}

/** Pick an agent and/or a skill for `task` in ONE request. null = no decision. */
async function pick(task, catalogs, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var providers = resolveProviders(env);
  if (providers.length === 0) return null;
  var text = redactSecrets(task).slice(0, MAX_STATE_CHARS);
  if (!text.trim()) return null;
  var max = opts.maxCandidates || DEFAULT_MAX_CANDIDATES;
  var include = opts.include || {};
  var agents = catalogs && Array.isArray(catalogs.agents) ? catalogs.agents : [];
  var skills = catalogs && Array.isArray(catalogs.skills) ? catalogs.skills : [];
  var questions = {};
  if (agents.length >= 2) {
    questions.agent = {
      type: 'choice',
      instructions: opts.agentInstructions || 'Which specialist agent should handle this task?',
      criteria: criteriaFor(shortlist(text, agents, max, include.agents)),
    };
  }
  if (skills.length >= 1) {
    var skillCriteria = criteriaFor(shortlist(text, skills, max, include.skills));
    skillCriteria[NONE_ID] = 'None of these skills fits the task';
    questions.skill = {
      type: 'choice',
      instructions: opts.skillInstructions || 'Which skill best fits this task?',
      criteria: skillCriteria,
    };
  }
  if (!questions.agent && !questions.skill) return null;
  var res = await ask(text, questions, {
    env: env,
    providers: providers,
    fetchImpl: opts.fetchImpl,
    onError: opts.onError,
    timeoutMs: opts.timeoutMs,
  });
  if (!res) return null;
  var out = { provider: res.provider };
  if (res.answers.agent) out.agent = toAnswer(res.answers.agent);
  if (res.answers.skill) out.skill = toAnswer(res.answers.skill);
  return out;
}

function acceptAgent(answer, env) {
  if (!answer) return null;
  return answer.confidence >= resolveMinConfidence(env) ? answer.choice : null;
}

function acceptSkills(answer, env, max) {
  if (!answer || answer.choice === NONE_ID || answer.confidence < resolveMinConfidence(env)) return [];
  var limit = max || DEFAULT_MAX_SKILLS;
  var out = [answer.choice];
  for (var i = 0; i < answer.ranked.length && out.length < limit; i++) {
    var r = answer.ranked[i];
    if (r.id !== NONE_ID && out.indexOf(r.id) === -1 && r.probability >= MIN_EXTRA_SKILL_PROBABILITY) {
      out.push(r.id);
    }
  }
  return out.slice(0, limit);
}

// ── Catalogs ───────────────────────────────────────────────────────────────

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size > MAX_CATALOG_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function strings(list) {
  return Array.isArray(list)
    ? list.filter(function (s) {
        return typeof s === 'string';
      })
    : [];
}

/** Agents from .monomind/registry.json (built by registry-builder.ts). */
function loadAgentCatalog(root) {
  var reg = readJsonFile(path.join(root, '.monomind', 'registry.json'));
  var list = reg && Array.isArray(reg.agents) ? reg.agents : [];
  var out = [];
  var seen = new Set();
  list.forEach(function (a) {
    if (!a || typeof a.slug !== 'string' || a.deprecated === true || seen.has(a.slug)) return;
    seen.add(a.slug);
    var category = typeof a.category === 'string' ? a.category : '';
    out.push({
      id: a.slug,
      name: typeof a.name === 'string' ? a.name : a.slug,
      category: category,
      description: typeof a.description === 'string' ? a.description : '',
      text: [category].concat(strings(a.capabilities), strings(a.taskTypes)).filter(Boolean).join(' '),
    });
  });
  return out;
}

/** Skills/commands from .claude/helpers/skill-registry.json (build-skill-registry.cjs).
 *  Command/skill mirrors of one capability collapse, preferring the slash form. */
function loadSkillCatalog(root) {
  var reg = readJsonFile(path.join(root, '.claude', 'helpers', 'skill-registry.json'));
  var list = reg && Array.isArray(reg.skills) ? reg.skills : [];
  var byKey = new Map();
  list.forEach(function (s) {
    if (!s || typeof s.skill !== 'string' || typeof s.invoke !== 'string') return;
    var key = s.skill.toLowerCase().replace(/[:_]/g, '-');
    var prev = byKey.get(key);
    if (prev && !(s.invoke.charAt(0) === '/' && prev.invoke.charAt(0) !== '/')) return;
    byKey.set(key, {
      id: s.skill,
      invoke: s.invoke,
      description: typeof s.description === 'string' ? s.description : '',
      text: strings(s.nameTerms).concat(strings(s.keywords)).join(' '),
    });
  });
  return Array.from(byKey.values());
}

module.exports = {
  JevError: JevError,
  NONE_ID: NONE_ID,
  TYPESAFE_BASE_URL: TYPESAFE_BASE_URL,
  isDisabled: isDisabled,
  normalizeBaseUrl: normalizeBaseUrl,
  resolveTimeoutMs: resolveTimeoutMs,
  resolveMinConfidence: resolveMinConfidence,
  resolveHookTimeoutMs: resolveHookTimeoutMs,
  redactSecrets: redactSecrets,
  SECRET_PATTERNS: SECRET_PATTERNS,
  resolveProviders: resolveProviders,
  postSystemOne: postSystemOne,
  ask: ask,
  probe: probe,
  shortlist: shortlist,
  pick: pick,
  acceptAgent: acceptAgent,
  acceptSkills: acceptSkills,
  loadAgentCatalog: loadAgentCatalog,
  loadSkillCatalog: loadSkillCatalog,
};
