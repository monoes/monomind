import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './org-hil.mjs';

// Extracted from handleMastermindEvent (server-mastermind-event.mjs) to keep that
// file under the line-count limit. Pure move — same logic, called inline.
function _accumulateAgentUsage(event, root, _orn) {
  // Usage accumulation — persist per-role token/cost data to state.json (accumulated
  // across runs). Real producers emit two distinct shapes and both must be handled:
  //  - 'agent:usage': flattened { role, tokens_in, tokens_out, cost_usd } (legacy/direct).
  //  - 'org:usage': orgrt's actual forwarded shape (attachForwarder's translate(), the
  //    default case for a raw OrgBus 'usage' event) — { from, data: { tokens, cost_usd } }.
  //    orgrt never emits 'agent:usage' itself, so without this branch real v2 cost data
  //    never reaches state.json even though the UI displays it as if it did.
  const _usageRole =
    event.type === 'agent:usage' ? event.role : event.type === 'org:usage' ? event.from : null;
  if (_usageRole) {
    try {
      const _arole = String(_usageRole).trim();
      if (_arole.length > 0 && _arole.length <= 64 && /^[a-z0-9][a-z0-9_-]*$/i.test(_arole)) {
        const _stateFile = path.join(root, '.monomind', 'orgs', `${_orn}-state.json`);
        let _st = {};
        try {
          _st = JSON.parse(fs.readFileSync(_stateFile, 'utf8'));
        } catch (_e) {
          // A missing file starts empty. One that exists but won't parse holds
          // the accumulated usage: keep a copy before it is rewritten.
          if (_e.code !== 'ENOENT') {
            try {
              fs.copyFileSync(_stateFile, `${_stateFile}.corrupt-${Date.now()}`);
            } catch (_c) {}
          }
        }
        if (!_st.agents) _st.agents = {};
        const _ex = _st.agents[_arole] || {};
        // ADR-O001 D1: orgrt's 'org:usage' now carries the four billable
        // quantities separately (tokens_in / tokens_out / cache_read /
        // cache_creation) alongside the `tokens` total, so the per-role rows
        // record real values instead of the 0s they used to persist.
        const _tokensIn =
          event.type === 'agent:usage'
            ? Number(event.tokens_in) || 0
            : Number(event.data?.tokens_in) || 0;
        const _tokensOut =
          event.type === 'agent:usage'
            ? Number(event.tokens_out) || 0
            : Number(event.data?.tokens_out) || 0;
        const _cacheRead = event.type === 'org:usage' ? Number(event.data?.cache_read) || 0 : 0;
        const _cacheCreation =
          event.type === 'org:usage' ? Number(event.data?.cache_creation) || 0 : 0;
        // 'org:usage' carries the billable total in data.tokens (cache
        // reads and writes included) — counted toward tokens_used, and NOT
        // re-added from the split fields, which are that same total broken
        // down rather than an extra amount.
        const _tokensTotal = event.type === 'org:usage' ? Number(event.data?.tokens) || 0 : 0;
        // null/missing = the runtime reported no cost (unknown, rev 28).
        const _rawCost = event.type === 'agent:usage' ? event.cost_usd : event.data?.cost_usd;
        const _costUsd =
          _rawCost === null || _rawCost === undefined || !Number.isFinite(Number(_rawCost))
            ? null
            : Number(_rawCost);
        _st.agents[_arole] = {
          ..._ex,
          tokens_in: (_ex.tokens_in || 0) + _tokensIn,
          tokens_out: (_ex.tokens_out || 0) + _tokensOut,
          cache_read_tokens: (_ex.cache_read_tokens || 0) + _cacheRead,
          cache_creation_tokens: (_ex.cache_creation_tokens || 0) + _cacheCreation,
          tokens_used:
            (_ex.tokens_used || 0) +
            (event.type === 'org:usage' ? _tokensTotal : _tokensIn + _tokensOut),
          total_cost_usd:
            _costUsd === null ? (_ex.total_cost_usd ?? null) : (_ex.total_cost_usd ?? 0) + _costUsd,
          lastUpdated: event.ts,
        };
        writeFileAtomic(_stateFile, JSON.stringify(_st, null, 2));
      }
    } catch (_e) {}
  }
}

export { _accumulateAgentUsage };
