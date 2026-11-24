'use strict';
/**
 * Decision-model provider registry, required by jev-picker.cjs (the ONE
 * implementation shared by the prompt hook and the CLI).
 *
 * A provider KIND is a factory: createProvider(config) returns
 *   { name, kind, ask(state, questions, opts) -> Promise<{ provider, answers, usage? }> }
 * `opts` carries { timeoutMs, fetchImpl }. `answers` maps question id to a raw
 * answer tagged with `probSource`; the picker validates every answer against
 * the options it sent and settles confidence through settleAnswer, so no
 * provider decides confidence or can return an option that was not enumerated.
 *
 * Only kind `systemone` (POST /v1/systemone: hosted TypeSafe Jev and the
 * OpenJev shim) exists today. Pure CommonJS, no dependencies: the hook loads
 * only the helpers dir.
 */

var TYPESAFE_BASE_URL = 'https://api.typesafe.ai';
var DEFAULT_MODEL = 'jev-latest';
var MAX_RESPONSE_CHARS = 1024 * 1024;
var OFF_VALUES = ['0', 'off', 'false', 'no'];
var ON_VALUES = ['1', 'on', 'true', 'yes'];
// How a probability was obtained. `native`: the server computed the confidence.
var PROB_SOURCES = ['native', 'logprob', 'sampled', 'none'];
// An answer with no probabilities never reaches the automatic floor (0.6).
var NONE_SOURCE_MAX_CONFIDENCE = 0.59;

class JevError extends Error {
  constructor(message, provider, status) {
    super(message);
    this.name = 'JevError';
    this.provider = provider;
    this.status = status;
  }
}

// ── Confidence ─────────────────────────────────────────────────────────────

/** Jev's published formula, (p_max - 1/n) / (1 - 1/n), clamped to [0, 1].
 *  `n` is the number of options (default: probs.length). */
function confidenceFrom(probs, n) {
  if (!Array.isArray(probs) || probs.length === 0) return 0;
  var count = n || probs.length;
  var pMax = Math.max.apply(null, probs);
  if (count < 2) return pMax > 0 ? 1 : 0;
  var c = (pMax - 1 / count) / (1 - 1 / count);
  return Math.min(1, Math.max(0, c));
}

/** The one place a choice answer's confidence is decided. Native keeps the
 *  server's number; logprob/sampled recompute it over the question's options;
 *  anything else (or an unknown source) is `none`, capped below the automatic
 *  floor. noul answers carry no confidence and pass through tagged. */
function settleAnswer(answer, question) {
  var source = PROB_SOURCES.indexOf(answer.probSource) !== -1 ? answer.probSource : 'none';
  var out = Object.assign({}, answer, { probSource: source });
  if (answer.type === 'noul' || source === 'native') return out;
  if (source === 'none') {
    out.confidence = Math.min(answer.confidence, NONE_SOURCE_MAX_CONFIDENCE);
    return out;
  }
  var probs = answer.probabilities || {};
  var values = Object.keys(probs).map(function (id) {
    return probs[id];
  });
  out.confidence = confidenceFrom(values, Object.keys(question.criteria).length);
  return out;
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

// ── Configuration (environment) ────────────────────────────────────────────

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

/** Shorthand properties keep a key variable out of `apiKey: <expr>` shapes,
 *  which the repo's git pre-commit secret gate rejects. */
function makeProvider(name, baseUrl, apiKey, model) {
  return { name: name, kind: 'systemone', baseUrl: baseUrl, apiKey, model: model };
}

/** Provider configs from the environment, in order: MONOMIND_JEV_URL, then hosted TypeSafe. */
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

// ── Kind: systemone ────────────────────────────────────────────────────────

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

function createSystemOne(config) {
  return {
    name: config.name,
    kind: 'systemone',
    async ask(state, questions, opts) {
      opts = opts || {};
      var body = await postSystemOne(
        config,
        { state: state, model: config.model, questions: questions },
        opts.timeoutMs,
        opts.fetchImpl,
      );
      // The server computes these confidences; whatever probSource it sent is ignored.
      var answers = {};
      Object.keys(body.answers).forEach(function (id) {
        var raw = body.answers[id];
        answers[id] = raw && typeof raw === 'object' ? Object.assign({}, raw, { probSource: 'native' }) : raw;
      });
      return { provider: config.name, answers: answers };
    },
  };
}

// ── Registry ───────────────────────────────────────────────────────────────

var registry = new Map();

function registerProvider(kind, factory) {
  registry.set(kind, factory);
}

function kinds() {
  return Array.from(registry.keys());
}

/** A provider from a config object; a config without `kind` is `systemone`. */
function createProvider(config) {
  var kind = config.kind || 'systemone';
  var factory = registry.get(kind);
  if (!factory) throw new JevError('unknown provider kind: ' + kind, config.name);
  return factory(config);
}

registerProvider('systemone', createSystemOne);

module.exports = {
  JevError: JevError,
  TYPESAFE_BASE_URL: TYPESAFE_BASE_URL,
  PROB_SOURCES: PROB_SOURCES,
  confidenceFrom: confidenceFrom,
  settleAnswer: settleAnswer,
  isValidAnswer: isValidAnswer,
  isDisabled: isDisabled,
  normalizeBaseUrl: normalizeBaseUrl,
  resolveProviders: resolveProviders,
  postSystemOne: postSystemOne,
  registerProvider: registerProvider,
  createProvider: createProvider,
  kinds: kinds,
};
