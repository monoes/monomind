'use strict';
// Claude Fable and GPT Astra models are never assigned or routed.
//
// The interactive (non-org) side of packages/@monomind/cli/src/model-guard.ts:
// PreToolUse Task|Agent refuses a subagent launch that names one. The two
// patterns are the same as the TypeScript module's; tests/hooks/model-guard-hook
// .test.mjs keeps them in step.

var BLOCKED = [/(^|[^a-z])fable([^a-z]|$)/i, /(^|[^a-z])astra([^a-z]|$)/i];

function isBlockedModel(model) {
  return typeof model === 'string' && BLOCKED.some(function (re) { return re.test(model); });
}

/** Blocks the launch (stderr decision + exit code 2, like the other gates) and
 *  returns true when the tool input names a blocked model. */
function handlePreAgent(hCtx) {
  var model = hCtx && hCtx.toolInput && hCtx.toolInput.model;
  if (!isBlockedModel(model)) return false;
  var reason = 'Model "' + model + '" is blocked: Claude Fable and GPT Astra models are never assigned or routed. '
    + 'Launch the subagent on another model, or leave "model" out.';
  process.stderr.write(JSON.stringify({ decision: 'block', reason: reason }) + '\n');
  process.exitCode = 2;
  return true;
}

module.exports = { isBlockedModel: isBlockedModel, handlePreAgent: handlePreAgent };
