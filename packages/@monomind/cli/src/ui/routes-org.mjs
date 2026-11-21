import { handleOrgAgentRoutes } from './routes-org-agents.mjs';
import { handleOrgApprovalRoutes } from './routes-org-approvals.mjs';
import { handleOrgConfigRoutes } from './routes-org-config.mjs';
import { handleOrgControlRoutes } from './routes-org-control.mjs';
import { handleOrgFileRoutes } from './routes-org-files.mjs';
import { handleOrgKnowledgeRoutes } from './routes-org-knowledge.mjs';
import { handleOrgLifecycleRoutes } from './routes-org-lifecycle.mjs';
import { handleOrgLiveRoutes } from './routes-org-live.mjs';
import { handleOrgMastermindRoutes } from './routes-org-mastermind.mjs';
import { handleOrgPlanningRoutes } from './routes-org-planning.mjs';
import { handleOrgRunRoutes } from './routes-org-runs.mjs';
import { handleOrgStatusRoutes } from './routes-org-status.mjs';

export async function handleOrgRoutes(req, res, url, corsOrigin, ctx) {
  if (await handleOrgConfigRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgAgentRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgStatusRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgApprovalRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgPlanningRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgFileRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgLifecycleRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgRunRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgMastermindRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgLiveRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgKnowledgeRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleOrgControlRoutes(req, res, url, corsOrigin, ctx)) return true;
  return false;
}
