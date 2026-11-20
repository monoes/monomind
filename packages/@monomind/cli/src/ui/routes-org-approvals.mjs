import path from 'node:path';
import * as hil from './org-hil.mjs';
import {
  decodeHilSegment,
  hilEvent,
  hilRespond,
  hilRoot,
  readHilBody,
  validOrgName,
} from './routes-org-helpers.mjs';

// Org dashboard routes: human-in-the-loop approvals, gates and questions.
// Registered, in order, by handleOrgRoutes in routes-org.mjs.
export async function handleOrgApprovalRoutes(req, res, url, corsOrigin, ctx) {
  // GET /api/org/:name/approvals — the org's tool/action approvals
  // (<org>/approvals.json, written by orgrt/approvals.ts), newest first.
  if (
    req.method === 'GET' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals(\?.*)?$/i)
  ) {
    const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
    return hilRespond(res, corsOrigin, () => {
      const approvals = hil.listApprovals(hilRoot(req, ctx), orgName);
      return { approvals, pending: approvals.filter((a) => a.status === 'pending').length };
    });
  }

  // GET /api/org/:name/gates — the org's decision gates (<org>/gates.json).
  if (req.method === 'GET' && url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/gates(\?.*)?$/i)) {
    const orgName = decodeURIComponent(url.split('/')[3].split('?')[0]);
    return hilRespond(res, corsOrigin, () => {
      const gates = hil.listGates(hilRoot(req, ctx), orgName);
      return { gates, pending: gates.filter((g) => g.status === 'pending').length };
    });
  }

  // GET /api/hil?dir= — everything in one project that waits on a human:
  // questions, approvals and decision gates across all its orgs.
  if (req.method === 'GET' && (url === '/api/hil' || url.startsWith('/api/hil?'))) {
    return hilRespond(res, corsOrigin, () => hil.pendingForProject(hilRoot(req, ctx)));
  }

  // POST /api/questions/answer { dir, org, questionId, answer } — live to the
  // hosting daemon (operator credential), else queued for the org's next run.
  if (req.method === 'POST' && url === '/api/questions/answer') {
    return hilRespond(res, corsOrigin, async () => {
      const body = await readHilBody(req);
      const { org, questionId, answer } = body || {};
      if (!validOrgName(org) || !questionId || typeof answer !== 'string' || !answer.trim())
        throw Object.assign(new Error('org, questionId and a non-empty answer are required'), {
          status: 400,
        });
      const root = path.resolve(body.dir || ctx.projectDir || process.cwd());
      const r = await hil.answerQuestion(root, org, String(questionId), answer.trim());
      hilEvent(ctx, root, {
        type: 'org:question-answered',
        org,
        role: r.role,
        questionId,
        delivery: r.delivery,
      });
      return { ok: true, ...r };
    });
  }

  // POST /api/questions/dismiss { dir, org, questionId, reason? } — #572: close
  // a question without an answer, live or recorded like an answer.
  if (req.method === 'POST' && url === '/api/questions/dismiss') {
    return hilRespond(res, corsOrigin, async () => {
      const body = await readHilBody(req);
      const { org, questionId, reason } = body || {};
      if (!validOrgName(org) || !questionId || (reason !== undefined && typeof reason !== 'string'))
        throw Object.assign(new Error('org and questionId are required; reason must be text'), {
          status: 400,
        });
      const root = path.resolve(body.dir || ctx.projectDir || process.cwd());
      const why = reason?.trim() ? reason.trim().slice(0, 4000) : undefined;
      const r = await hil.dismissQuestion(root, org, String(questionId), why);
      hilEvent(ctx, root, {
        type: 'org:question-answered',
        org,
        role: r.role,
        questionId,
        delivery: r.delivery,
        dismissed: true,
      });
      return { ok: true, ...r };
    });
  }

  // POST /api/org/:name/gates/:id { approved: boolean, resolution? } — resolve
  // a decision gate, live or (org not running) in gates.json.
  if (
    req.method === 'POST' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/gates\/[^/?]+(\?.*)?$/i)
  ) {
    const parts = url.split('?')[0].split('/');
    const orgName = decodeURIComponent(parts[3]);
    const root = hilRoot(req, ctx);
    return hilRespond(res, corsOrigin, async () => {
      const gateId = decodeHilSegment(parts[5]);
      const body = await readHilBody(req);
      const resolution =
        typeof body?.resolution === 'string' && body.resolution.trim()
          ? body.resolution.trim().slice(0, 4000)
          : undefined;
      if (typeof body?.approved !== 'boolean')
        throw Object.assign(new Error('approved (boolean) is required'), { status: 400 });
      const r = await hil.resolveGate(root, orgName, gateId, body.approved, resolution);
      const status = body.approved ? 'approved' : 'rejected';
      hilEvent(ctx, root, {
        type: 'org:gate:resolved',
        org: orgName,
        gateId,
        status,
        delivery: r.delivery,
      });
      return { ok: true, status, ...r };
    });
  }

  // POST /api/org/:name/approvals/:requestId { action: "approve" | "reject" } —
  // resolve one tool/action approval, live or (org not running) in approvals.json.
  if (
    req.method === 'POST' &&
    url.match(/^\/api\/org\/[a-z0-9][a-z0-9_-]{0,63}\/approvals\/[^/?]+(\?.*)?$/i)
  ) {
    const parts = url.split('?')[0].split('/');
    const orgName = decodeURIComponent(parts[3]);
    const root = hilRoot(req, ctx);
    return hilRespond(res, corsOrigin, async () => {
      const requestId = decodeHilSegment(parts[5]);
      const body = await readHilBody(req);
      if (body?.action !== 'approve' && body?.action !== 'reject')
        throw Object.assign(new Error('action must be approve or reject'), { status: 400 });
      const approved = body.action === 'approve';
      const r = await hil.resolveApproval(root, orgName, requestId, approved);
      const status = approved ? 'approved' : 'denied';
      hilEvent(ctx, root, {
        type: 'org:approval:resolved',
        org: orgName,
        requestId,
        status,
        delivery: r.delivery,
      });
      return { ok: true, status, ...r };
    });
  }
  return false;
}
