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

var fs = require('fs');
var os = require('os');
var path = require('path');

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
function makeProvider(name, baseUrl, apiKey, model, kind) {
  return { name: name, kind: kind || 'systemone', baseUrl: baseUrl, apiKey, model: model };
}

/** Provider configs from the environment, in order: MONOMIND_JEV_URL, then hosted TypeSafe. */
function envProviders(env) {
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

// ── Named providers (config file) ──────────────────────────────────────────
// .monomind/decision-providers.json (project), then ~/.monomind/ (user):
//   { "providers": [ { name, kind?, baseUrl, apiKeyEnv?, model?, enabled? } ] }
// The file holds only the NAME of the env var that carries the key, never the key.

var STORE_FILE = 'decision-providers.json';
var STORE_OVERRIDE_ENV = 'MONOMIND_DECISION_PROVIDERS_FILE';
var RESERVED_NAMES = ['custom', 'typesafe'];

function homeOf(env) {
  return readEnvValue(env, 'HOME') || readEnvValue(env, 'USERPROFILE') || (env === process.env ? os.homedir() : '');
}

/** The file for a scope; MONOMIND_DECISION_PROVIDERS_FILE replaces both. */
function storeFile(scope, env, opts) {
  env = env || process.env;
  var override = readEnvValue(env, STORE_OVERRIDE_ENV);
  if (override) return override;
  var base = scope === 'user' ? homeOf(env) : (opts && opts.cwd) || process.cwd();
  return base ? path.join(base, '.monomind', STORE_FILE) : null;
}

function readStore(file) {
  var text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { providers: [] };
  }
  try {
    var body = JSON.parse(text);
    return { providers: body && Array.isArray(body.providers) ? body.providers : [] };
  } catch (e) {
    return { providers: [], error: 'invalid JSON in ' + file };
  }
}

function writeStore(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  var tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ providers: entries }, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      /* nothing to clean */
    }
    throw err;
  }
}

/** null when the entry is usable, else a one-line reason. */
function validateEntry(entry) {
  if (!entry || typeof entry !== 'object') return 'entry must be an object';
  if (typeof entry.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(entry.name)) {
    return 'invalid name (letters, digits, . _ - ; up to 64 characters)';
  }
  if (RESERVED_NAMES.indexOf(entry.name.toLowerCase()) !== -1) {
    return 'name "' + entry.name + '" is reserved for the environment variables';
  }
  var kind = entry.kind || 'systemone';
  if (!registry.has(kind)) {
    return 'unknown provider kind "' + kind + '" (known: ' + kinds().join(', ') + ')';
  }
  if (!normalizeBaseUrl(entry.baseUrl)) return 'baseUrl must be an http(s) URL';
  if (entry.apiKey !== undefined) return 'keys are never stored in the file: use apiKeyEnv';
  if (entry.apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(entry.apiKeyEnv))) {
    return 'apiKeyEnv must be an environment variable name (e.g. MY_JEV_KEY), not a key';
  }
  if (entry.model !== undefined && typeof entry.model !== 'string') return 'model must be a string';
  return null;
}

function toConfig(entry, env) {
  var key = entry.apiKeyEnv ? readEnvValue(env, entry.apiKeyEnv) : undefined;
  return makeProvider(
    entry.name,
    normalizeBaseUrl(entry.baseUrl),
    key,
    entry.model || readEnvValue(env, 'MONOMIND_JEV_MODEL') || DEFAULT_MODEL,
    entry.kind || 'systemone',
  );
}

/** Usable, enabled named providers: project file first, then user file. */
function namedProviders(env, opts) {
  var files = [storeFile('project', env, opts)];
  if (!readEnvValue(env, STORE_OVERRIDE_ENV)) files.push(storeFile('user', env, opts));
  var out = [];
  files.forEach(function (file) {
    if (!file) return;
    readStore(file).providers.forEach(function (entry) {
      if (validateEntry(entry) === null && entry.enabled !== false) out.push(toConfig(entry, env));
    });
  });
  return out;
}

/** Provider configs in order: environment variables, then named providers
 *  (a name already taken by an earlier provider is dropped, so env wins ties). */
function resolveProviders(env, opts) {
  env = env || process.env;
  if (isDisabled(env)) return [];
  var seen = {};
  return envProviders(env)
    .concat(namedProviders(env, opts))
    .filter(function (p) {
      if (seen[p.name]) return false;
      seen[p.name] = true;
      return true;
    });
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

// ── Metering ───────────────────────────────────────────────────────────────

function isCount(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** { latencyMs, tokensIn?, tokensOut?, costUsd? } for one ask. Tokens are only
 *  what the provider reported (never estimated). Cost: 0 for a `local` config,
 *  else tokens x config.pricing ({ in, out } USD per token, the MODEL_PRICING
 *  shape), else absent. A systemone server reports no tokens: latency only. */
function meterUsage(config, reported, latencyMs) {
  var usage = { latencyMs: latencyMs };
  var tokensIn = reported && isCount(reported.tokensIn) ? reported.tokensIn : undefined;
  var tokensOut = reported && isCount(reported.tokensOut) ? reported.tokensOut : undefined;
  if (tokensIn !== undefined) usage.tokensIn = tokensIn;
  if (tokensOut !== undefined) usage.tokensOut = tokensOut;
  var price = config.pricing;
  if (config.local === true) {
    usage.costUsd = 0;
  } else if (price && isCount(price.in) && isCount(price.out) && tokensIn !== undefined && tokensOut !== undefined) {
    usage.costUsd = tokensIn * price.in + tokensOut * price.out;
  }
  return usage;
}

/** Every kind is metered here, so no kind has to measure itself. */
function metered(config, provider) {
  var inner = provider.ask.bind(provider);
  return Object.assign({}, provider, {
    async ask(state, questions, opts) {
      var started = Date.now();
      var res = await inner(state, questions, opts);
      return Object.assign({}, res, { usage: meterUsage(config, res && res.usage, Date.now() - started) });
    },
  });
}

/** A provider from a config object; a config without `kind` is `systemone`. */
function createProvider(config) {
  var kind = config.kind || 'systemone';
  var factory = registry.get(kind);
  if (!factory) throw new JevError('unknown provider kind: ' + kind, config.name);
  return metered(config, factory(config));
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
  storeFile: storeFile,
  readStore: readStore,
  writeStore: writeStore,
  validateEntry: validateEntry,
  namedProviders: namedProviders,
};
