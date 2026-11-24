'use strict';
/**
 * Decision-provider kind `hf-zeroshot`: a Hugging Face zero-shot-classification
 * model (POST <baseUrl>/models/<model>), e.g. facebook/bart-large-mnli behind
 * the Inference API, a dedicated endpoint, or a text-embeddings-style server
 * with the same shape. Required by jev-providers.cjs, which hands in its api
 * ({ JevError, postJson, registerProvider }); pure CommonJS, plain fetch.
 *
 * Only `choice` and yes/no (`noul`, `score`) questions exist. The option
 * descriptions are the candidate labels; the classifier's scores over exactly
 * those labels are softmax probabilities, so they are tagged 'logprob' (the
 * central confidence formula applies). A returned label that was not sent is
 * discarded.
 */

var MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;

/** Options with a unique candidate label each (colliding descriptions get the id appended). */
function optionsOf(question) {
  if (question.type !== 'choice') {
    return [
      { id: 'yes', label: 'yes' },
      { id: 'no', label: 'no' },
    ];
  }
  var seen = {};
  return Object.keys(question.criteria || {}).map(function (id) {
    var label = String(question.criteria[id]);
    if (seen[label]) label = label + ' [' + id + ']';
    seen[label] = true;
    return { id: id, label: label };
  });
}

/** [{ label, score }] from either reply shape, or null. */
function pairsOf(body) {
  if (Array.isArray(body)) {
    return body.filter(function (e) { return e && typeof e.label === 'string'; });
  }
  if (body && Array.isArray(body.labels) && Array.isArray(body.scores)) {
    return body.labels.map(function (label, i) { return { label: label, score: body.scores[i] }; });
  }
  return null;
}

function answerFor(question, options, body) {
  var pairs = pairsOf(body);
  if (!pairs) return null;
  var mass = {};
  var total = 0;
  pairs.forEach(function (p) {
    var option = options.filter(function (o) { return o.label === p.label; })[0];
    if (!option || !Number.isFinite(p.score) || p.score < 0) return;
    mass[option.id] = (mass[option.id] || 0) + p.score;
    total += p.score;
  });
  if (!(total > 0)) return null;
  if (question.type !== 'choice') return { type: question.type, noul: (mass.yes || 0) / total, probSource: 'logprob' };
  var probabilities = {};
  var best = options[0].id;
  options.forEach(function (o) {
    probabilities[o.id] = (mass[o.id] || 0) / total;
    if (probabilities[o.id] > probabilities[best]) best = o.id;
  });
  return { type: 'choice', choice: best, confidence: probabilities[best], probabilities: probabilities, probSource: 'logprob' };
}

module.exports = function register(api) {
  function post(config, state, question, options, opts) {
    var headers = {};
    if (config.apiKey) headers.authorization = 'Bearer ' + config.apiKey;
    var text = question.type === 'choice' ? state : String(question.instructions || '') + '\n\n' + state;
    var body = {
      inputs: text,
      parameters: {
        candidate_labels: options.map(function (o) { return o.label; }),
        multi_label: false,
      },
    };
    return api.postJson(config, config.baseUrl + '/models/' + config.model, headers, body, opts.timeoutMs, opts.fetchImpl, true);
  }

  function create(config) {
    return {
      name: config.name,
      kind: 'hf-zeroshot',
      async ask(state, questions, opts) {
        opts = opts || {};
        var ids = Object.keys(questions);
        var settled = await Promise.allSettled(
          ids.map(function (id) {
            var options = optionsOf(questions[id]);
            return post(config, state, questions[id], options, opts).then(function (body) {
              return answerFor(questions[id], options, body);
            });
          }),
        );
        var answers = {};
        var firstError = null;
        settled.forEach(function (r, i) {
          if (r.status === 'rejected') firstError = firstError || r.reason;
          else if (r.value) answers[ids[i]] = r.value;
        });
        if (firstError && Object.keys(answers).length === 0) throw firstError;
        // The service reports no tokens: latency (and 0 cost when local) only.
        return { provider: config.name, answers: answers };
      },
    };
  }

  function validate(entry) {
    if (typeof entry.model !== 'string' || !MODEL_PATTERN.test(entry.model)) {
      return 'model is required for kind hf-zeroshot (a model id such as facebook/bart-large-mnli)';
    }
    return null;
  }

  api.registerProvider('hf-zeroshot', create, { validate: validate, hookEligible: function () { return true; } });
};
