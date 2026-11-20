import { handleDoctorRoutes } from './routes-doctor.mjs';
import { handleMonoesRoutes } from './routes-monoes.mjs';
import { handleMonographRoutes } from './routes-monograph.mjs';
import { handleOrgRoutes } from './routes-org.mjs';
import { handleRoutesData } from './server-routes-data.mjs';
import { handleRoutesDocs } from './server-routes-docs.mjs';
import { handleRoutesEvents } from './server-routes-events.mjs';
import { handleRoutesLoops } from './server-routes-loops.mjs';
import { handleMcpCallRoutes } from './server-routes-mcp-call.mjs';
import { handleRoutesMemory1 } from './server-routes-memory-1.mjs';
import { handleRoutesMemory2 } from './server-routes-memory-2.mjs';
import { handleRoutesMisc } from './server-routes-misc.mjs';
import { handleRoutesPages } from './server-routes-pages.mjs';

// Full route dispatch, extracted from startServer()'s createServer callback (this
// file's line-count limit). Tries every extracted route-group handler, in the same
// order they were registered inline before this split, then the two still-inline
// delegations (monoes.me, org/mastermind). Returns true if some handler responded.
async function dispatchRequest(req, res, url, corsOrigin, deps) {
  const {
    projectDir,
    __dirname,
    dashboardAuthValue,
    tokenState,
    shutdown,
    MONOMIND_HOME,
    _boundPortForCors,
    activeOrgRuns,
    _resolveOrgProjectDir,
    runStreamClients,
    broadcastMm,
    appendToFile,
    _getActiveRunId,
    removeMmClient,
    _runDb,
    parseAgentDef,
    handleMastermindEvent,
    addMmClient,
    _getGitMonomindDir,
    _detectMimeType,
    _readRunState,
    _getAllowedArtifactDirs,
    _updateRunState,
    _getKnowledgeBridge,
    SESSION_ID_RE,
    MASTERMIND_DIAGRAM_HTML,
    buildDocsState,
    looksLikeOurProcess,
  } = deps;

  // Shared ctx for every extracted route-group handler (not every field is used
  // by every handler — same pattern as handleOrgRoutes's ctx below).
  const ctx = { projectDir, __dirname, dashboardAuthValue, tokenState, shutdown };

  if (await handleRoutesPages(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesData(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesEvents(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesDocs(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesMemory1(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesMemory2(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesLoops(req, res, url, corsOrigin, ctx)) return true;
  if (await handleRoutesMisc(req, res, url, corsOrigin, ctx)) return true;
  if (await handleMcpCallRoutes(req, res, url, corsOrigin, ctx)) return true;
  if (await handleDoctorRoutes(req, res, url, corsOrigin, ctx)) return true;

  // ── Monograph routes (extracted to routes-monograph.mjs) ──────────────
  if (
    await handleMonographRoutes(req, res, url, corsOrigin, {
      projectDir,
      buildDocsState,
      looksLikeOurProcess,
    })
  )
    return true;

  // ── monoes.me connection routes (extracted to routes-monoes.mjs) ───────
  if (
    await handleMonoesRoutes(req, res, url, corsOrigin, {
      MONOMIND_HOME,
      dashboardPort: _boundPortForCors,
      projectDir,
      _resolveOrgProjectDir,
    })
  )
    return true;

  // ── Org/mastermind routes (extracted to routes-org.mjs) ────────────────
  if (
    await handleOrgRoutes(req, res, url, corsOrigin, {
      projectDir,
      activeOrgRuns,
      _resolveOrgProjectDir,
      runStreamClients,
      broadcastMm,
      appendToFile,
      _getActiveRunId,
      removeMmClient,
      _runDb,
      parseAgentDef,
      MONOMIND_HOME,
      handleMastermindEvent,
      addMmClient,
      _getGitMonomindDir,
      _detectMimeType,
      _readRunState,
      _getAllowedArtifactDirs,
      _updateRunState,
      _getKnowledgeBridge,
      SESSION_ID_RE,
      MASTERMIND_DIAGRAM_HTML,
      dashboardAuthValue,
      __dirname,
    })
  )
    return true;

  return false;
}

export { dispatchRequest };
