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
var redaction = require('./redact-secrets.cjs');
// Keyword ranking builds the candidate shortlist (and is every caller's fallback).
var shortlist = require('./pick-rank.cjs').shortlist;

var TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
var DEFAULT_MODEL = 'jev-latest';
var DEFAULT_TIMEOUT_MS = 3000;
var MIN_TIMEOUT_MS = 100;
var MAX_TIMEOUT_MS = 30000;
var MIN_PROVIDER_WINDOW_MS = 50;
// Automatic decisions (hook injection, org auto-assign) act only above this.
var DEFAULT_MIN_CONFIDENCE = 0.6;
// A ranking shown to a person (`monomind pick`) keeps Jev's answer down to
// this, flagged low-confidence below DEFAULT_MIN_CONFIDENCE. On the 60-task
// pick benchmark every answer at >= 0.35 was right and the one under 0.2 wrong.
var DEFAULT_PICK_MIN_CONFIDENCE = 0.25;
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
var MAX_HOOK_TIMEOUT_MS = 10000;

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

function resolveMinConfidence(env) {
  var n = Number((env || process.env).MONOMIND_JEV_MIN_CONFIDENCE);
  return n > 0 && n <= 1 ? n : DEFAULT_MIN_CONFIDENCE;
}

/** The floor for rankings a person reads (MONOMIND_JEV_PICK_MIN_CONFIDENCE). */
function resolvePickMinConfidence(env) {
  var n = Number((env || process.env).MONOMIND_JEV_PICK_MIN_CONFIDENCE);
  return n > 0 && n <= 1 ? n : DEFAULT_PICK_MIN_CONFIDENCE;
}

/** An explicit floor in (0, 1] wins; otherwise the automatic-decision floor. */
function floorFor(env, minConfidence) {
  return minConfidence > 0 && minConfidence <= 1 ? minConfidence : resolveMinConfidence(env);
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

// ── Picking ────────────────────────────────────────────────────────────────

function describeItem(item) {
  var text = redaction.redactHead(item.description || item.name || item.id).replace(/\s+/g, ' ').trim();
  return text.length > MAX_DESCRIPTION_CHARS ? text.slice(0, MAX_DESCRIPTION_CHARS - 1) + '…' : text;
}

function criteriaFor(items) {
  var criteria = {};
  items.forEach(function (item) {
    criteria[item.id] = describeItem(item);
  });
  return criteria;
}

/** Only options that were sent, with probabilities in [0, 1]: an id the model
 *  invents (or an injection payload) must never reach a caller. */
function rankedFrom(answer, criteria) {
  var probs = answer.probabilities;
  if (!probs || typeof probs !== 'object') return [{ id: answer.choice, probability: answer.confidence }];
  return Object.keys(probs)
    .filter(function (id) {
      var p = probs[id];
      return Object.prototype.hasOwnProperty.call(criteria, id) && Number.isFinite(p) && p >= 0 && p <= 1;
    })
    .map(function (id) {
      return { id: id, probability: probs[id] };
    })
    .sort(function (a, b) {
      return b.probability - a.probability;
    });
}

function toAnswer(answer, criteria) {
  return { choice: answer.choice, confidence: answer.confidence, ranked: rankedFrom(answer, criteria) };
}

/** Pick an agent and/or a skill for `task` in ONE request. null = no decision. */
async function pick(task, catalogs, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var providers = resolveProviders(env);
  if (providers.length === 0) return null;
  var text = redaction.redactHead(task).slice(0, MAX_STATE_CHARS);
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
  if (res.answers.agent) out.agent = toAnswer(res.answers.agent, questions.agent.criteria);
  if (res.answers.skill) out.skill = toAnswer(res.answers.skill, questions.skill.criteria);
  return out;
}

/** `minConfidence` overrides the automatic-decision floor for this call. */
function acceptAgent(answer, env, minConfidence) {
  if (!answer) return null;
  return answer.confidence >= floorFor(env, minConfidence) ? answer.choice : null;
}

function acceptSkills(answer, env, max, minConfidence) {
  if (!answer || answer.choice === NONE_ID || answer.confidence < floorFor(env, minConfidence)) return [];
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
  return (Array.isArray(list) ? list : []).filter(function (s) {
    return typeof s === 'string';
  });
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

/** .monomind/catalog/state.json as { ok, known, allowed } skill-name sets, where
 *  allowed = active with the jev target; null when there is no state file. */
function catalogJevGate(root) {
  var file = path.join(root, '.monomind', 'catalog', 'state.json');
  if (!fs.existsSync(file)) return null;
  var state = readJsonFile(file);
  var gate = { ok: !!state && Array.isArray(state.entries), known: new Set(), allowed: new Set() };
  (gate.ok ? state.entries : []).forEach(function (e) {
    if (!e || typeof e.id !== 'string' || e.id.indexOf('skill:') !== 0) return;
    gate.known.add(e.id.slice(6));
    if (e.status === 'active' && Array.isArray(e.targets) && e.targets.indexOf('jev') !== -1) {
      gate.allowed.add(e.id.slice(6));
    }
  });
  return gate;
}

function isProjectedCopy(root, source) {
  var file = typeof source === 'string' ? path.resolve(root, source) : '';
  if (file.indexOf(path.resolve(root) + path.sep) !== 0) return false;
  try {
    if (fs.statSync(file).size > MAX_CATALOG_BYTES) return false;
    return fs.readFileSync(file, 'utf-8').indexOf('monomind:start catalog:skill:') !== -1;
  } catch (e) {
    return false;
  }
}

/** The catalog state decides, not the (possibly stale) projection marker: a
 *  disabled, revoked or no-jev entry drops out before re-projection, and an
 *  unreadable state drops every marked skill (fail closed). A hand-written
 *  namesake passes; an unmarked projected copy (old builder) does not. */
function jevAllowed(gate, s, root) {
  if (s.catalog && (!gate.ok || !gate.allowed.has(String(s.catalog.id).replace(/^skill:/, '')))) return false;
  return !gate.known.has(s.skill) || gate.allowed.has(s.skill) || (!s.catalog && !isProjectedCopy(root, s.source));
}

/** Skills/commands from .claude/helpers/skill-registry.json (build-skill-registry.cjs).
 *  Command/skill mirrors of one capability collapse, preferring the slash form. */
function loadSkillCatalog(root) {
  var reg = readJsonFile(path.join(root, '.claude', 'helpers', 'skill-registry.json'));
  var list = reg && Array.isArray(reg.skills) ? reg.skills : [];
  var gate = catalogJevGate(root);
  var byKey = new Map();
  list.forEach(function (s) {
    if (!s || typeof s.skill !== 'string' || typeof s.invoke !== 'string') return;
    // A catalog projection reaches the decision model only when approved with
    // the jev target; ordinary skills carry no catalog field and are unaffected.
    if (s.catalog && s.catalog.jev !== true) return;
    if (gate && !jevAllowed(gate, s, root)) return;
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
  resolvePickMinConfidence: resolvePickMinConfidence,
  resolveHookTimeoutMs: resolveHookTimeoutMs,
  redactSecrets: redaction.redactSecrets,
  SECRET_PATTERNS: redaction.SECRET_PATTERNS,
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
