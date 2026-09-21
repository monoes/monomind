// Human-in-the-loop actions for the dashboard: approvals, decision gates,
// ask_human answers and human chat messages for Org Runtime v2 orgs.
//
// Same shape as the `monomind org approve|deny|gate-*|answer` commands
// (commands/org-observe.ts): when a daemon hosts the org, the decision goes to
// its operator-only routes with the operator credential, and the daemon both
// records it and wakes the waiting role. When no daemon hosts the org, the
// decision is recorded in the org's own files, where the next run finds it.
// Unlike the CLI, a live daemon that REJECTS the call is reported as an error
// instead of falling back to a file write the daemon would overwrite.
import fs from 'node:fs';
import path from 'node:path';
// Compiled from orgrt/*.ts, like forwarder.js in routes-org.mjs.
import { lookupOrg, readOperatorCredential } from '../orgrt/broker.js';
import { queueMessage } from '../orgrt/inbox.js';

/** Recorded as resolvedBy on everything decided here (normalizeResolver-valid). */
export const DASHBOARD_RESOLVER = 'human:dashboard';

const orgDir = (root, org) => path.join(root, '.monomind', 'orgs', org);

class HilError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Read `<orgDir>/<file>` → its `key` array. Missing file → []. A file that
 *  exists but can't be parsed THROWS: callers rewrite what this returns, and
 *  rewriting from [] would erase every other entry. */
function readList(root, org, file, key) {
  const p = path.join(orgDir(root, org), file);
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new HilError(500, `cannot read ${p}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new HilError(500, `${p} is not valid JSON (${err.message})`);
  }
  const list = parsed?.[key] ?? [];
  if (!Array.isArray(list)) throw new HilError(500, `${p}: "${key}" is not an array`);
  return list;
}

function writeList(root, org, file, key, list) {
  const dir = orgDir(root, org);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, file);
  const tmp = `${dest}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ [key]: list }, null, 2));
  fs.renameSync(tmp, dest);
}

/** POST to the hosting daemon's operator-only `route`. Returns null when no
 *  live daemon hosts `org`; otherwise the daemon's verdict. */
async function callDaemon(org, route, body) {
  const remote = lookupOrg(org);
  if (!remote) return null;
  const cred = readOperatorCredential(org);
  if (!cred)
    throw new HilError(
      503,
      `org "${org}" is running, but its operator credential (~/.monomind/orgrt-operator/${org}.json) is missing — the dashboard cannot act for a human`,
    );
  let res;
  try {
    res = await fetch(`${remote.url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-monomind-cred': cred },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HilError(502, `org "${org}" daemon unreachable: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok)
    throw new HilError(
      res.status >= 400 ? res.status : 502,
      data.error || `daemon returned ${res.status}`,
    );
  return data;
}

function approvalStatus(a) {
  if (a.approved === true) return 'approved';
  if (a.approved === false) return 'denied';
  return 'pending';
}

/** The org's tool/action approvals (`<org>/approvals.json`), newest first. */
export function listApprovals(root, org) {
  return readList(root, org, 'approvals.json', 'approvals')
    .map((a) => ({
      id: a.requestId || null,
      roleId: a.roleId,
      action: a.action,
      input: a.input || null,
      status: approvalStatus(a),
      ts: a.ts || null,
      resolvedBy: a.resolvedBy || null,
      resolvedAt: a.resolvedAt || null,
    }))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

/** The org's decision gates (`<org>/gates.json`), newest first. */
export function listGates(root, org) {
  return readList(root, org, 'gates.json', 'gates')
    .map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      roleId: g.roleId,
      status: g.status || 'pending',
      createdAt: g.createdAt || null,
      resolvedBy: g.resolvedBy || null,
      resolvedAt: g.resolvedAt || null,
      resolution: g.resolution || null,
    }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

/** The org's ask_human questions. `blocking` is false only when the role said
 *  it can carry on without an answer; pre-D4 records read as blocking. */
export function listQuestions(root, org) {
  return readList(root, org, 'questions.json', 'questions').map((q) => ({
    ...q,
    blocking: q.blocking !== false,
  }));
}

/** Everything awaiting a human across every org in `root`. */
export function pendingForProject(root) {
  const base = path.join(root, '.monomind', 'orgs');
  const out = { questions: [], approvals: [], gates: [], errors: [] };
  let entries = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory() || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(e.name)) continue;
    const org = e.name;
    try {
      for (const q of listQuestions(root, org)) out.questions.push({ org, ...q });
      for (const a of listApprovals(root, org)) out.approvals.push({ org, ...a });
      for (const g of listGates(root, org)) out.gates.push({ org, ...g });
    } catch (err) {
      out.errors.push({ org, error: err.message });
    }
  }
  return out;
}

export async function resolveApproval(root, org, requestId, approved) {
  const entry = readList(root, org, 'approvals.json', 'approvals').find(
    (a) => a.requestId === requestId,
  );
  if (!entry) throw new HilError(404, `approval "${requestId}" not found for org "${org}"`);
  if (entry.approved !== null)
    throw new HilError(409, `approval "${requestId}" already ${approvalStatus(entry)}`);
  const live = await callDaemon(org, '/api/set-approval', {
    org,
    role: entry.roleId,
    action: entry.action,
    approved,
    resolvedBy: DASHBOARD_RESOLVER,
    requestId,
  });
  if (live) return { delivery: 'live' };
  // Offline: re-read so a write since the lookup above isn't reverted.
  const fresh = readList(root, org, 'approvals.json', 'approvals');
  const item = fresh.find((a) => a.requestId === requestId);
  if (!item || item.approved !== null)
    throw new HilError(409, `approval "${requestId}" was resolved meanwhile`);
  const now = Date.now();
  Object.assign(item, { approved, ts: now, resolvedBy: DASHBOARD_RESOLVER, resolvedAt: now });
  writeList(root, org, 'approvals.json', 'approvals', fresh);
  return { delivery: 'recorded' };
}

export async function resolveGate(root, org, gateId, approved, resolution) {
  const gate = readList(root, org, 'gates.json', 'gates').find((g) => g.id === gateId);
  if (!gate) throw new HilError(404, `gate "${gateId}" not found for org "${org}"`);
  if (gate.status !== 'pending')
    throw new HilError(409, `gate "${gateId}" already resolved (${gate.status})`);
  const live = await callDaemon(org, '/api/resolve-gate', {
    org,
    gateId,
    approved,
    resolution,
    resolvedBy: DASHBOARD_RESOLVER,
  });
  if (live) return { delivery: 'live' };
  const fresh = readList(root, org, 'gates.json', 'gates');
  const idx = fresh.findIndex((g) => g.id === gateId);
  if (idx === -1 || fresh[idx].status !== 'pending')
    throw new HilError(409, `gate "${gateId}" was resolved meanwhile`);
  fresh[idx] = {
    ...fresh[idx],
    status: approved ? 'approved' : 'rejected',
    resolvedAt: Date.now(),
    resolvedBy: DASHBOARD_RESOLVER,
    ...(resolution ? { resolution } : {}),
  };
  writeList(root, org, 'gates.json', 'gates', fresh);
  return { delivery: 'recorded' };
}

export async function answerQuestion(root, org, questionId, answer) {
  const q = readList(root, org, 'questions.json', 'questions').find(
    (x) => x.questionId === questionId,
  );
  if (!q) throw new HilError(404, `question "${questionId}" not found for org "${org}"`);
  if (q.answer !== null && q.answer !== undefined)
    throw new HilError(409, `question "${questionId}" was already answered`);
  const live = await callDaemon(org, '/api/answer-question', {
    org,
    role: q.role,
    questionId,
    answer,
    resolvedBy: DASHBOARD_RESOLVER,
  });
  if (live) return { delivery: 'live', role: q.role };
  const fresh = readList(root, org, 'questions.json', 'questions');
  const freshQ = fresh.find((x) => x.questionId === questionId);
  if (freshQ && freshQ.answer !== null && freshQ.answer !== undefined)
    throw new HilError(409, `question "${questionId}" was answered meanwhile`);
  // Queue BEFORE marking answered (daemon.answerQuestion's rule): a failed
  // append must leave the question pending and answerable.
  const queued = queueMessage(root, org, {
    fromQualified: 'human',
    toRole: q.role,
    subject: `answer:${questionId}`,
    body: `question: ${q.question}\n\nanswer: ${answer}`,
    ts: Date.now(),
  });
  if (!queued) throw new HilError(500, 'could not queue the answer — it was NOT recorded, retry');
  const now = Date.now();
  const answered = { answer, answeredAt: now, resolvedBy: DASHBOARD_RESOLVER };
  const merged = fresh.some((x) => x.questionId === questionId)
    ? fresh.map((x) => (x.questionId === questionId ? { ...x, ...answered } : x))
    : [...fresh, { ...q, ...answered }];
  writeList(root, org, 'questions.json', 'questions', merged);
  return { delivery: 'queued', role: q.role };
}

/** Deliver `text` to `role`: live into its mailbox, else into the org's
 *  inbox, which the daemon drains when the org next starts. */
export async function sendHumanMessage(root, org, role, text) {
  const live = await callDaemon(org, '/api/human-message', { org, role, text });
  if (live) return { delivery: 'live' };
  const queued = queueMessage(root, org, {
    fromQualified: 'human',
    toRole: role,
    subject: 'message from human',
    body: text,
    ts: Date.now(),
  });
  if (!queued) throw new HilError(500, 'could not queue the message');
  return { delivery: 'queued' };
}

/** Map a thrown error to an HTTP status + message. */
export function hilErrorStatus(err) {
  return { status: err instanceof HilError ? err.status : 500, error: err.message };
}
