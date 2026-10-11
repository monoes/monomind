import fs from 'node:fs';
import path from 'node:path';

// Factory: these three closed over projectDir + dashboardAuthValue (per-server-
// start state) and mutated a private _dashboardTokenFilePath — now tokenState.path,
// a plain object so shutdown()/the /api/identity route can read the live value
// after this moved out of startServer's own closure.
// Port named by a control.json url, parsed (a substring test would match :4242 in :42421).
function _controlUrlPort(rawUrl) {
  try {
    const u = new URL(String(rawUrl || ''));
    return Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  } catch (_) {
    return null;
  }
}

function createDashboardTokenManager({ projectDir, dashboardAuthValue }) {
  const tokenState = { path: null };
  // #366: control-start spawns a server only as THIS project's primary (it
  // passes MONOMIND_CONTROL_PRIMARY=1). Its own optimistic control.json names
  // the default port, which another project's server may answer, so the check
  // below would wrongly make it a secondary — the project's dashboard-token
  // then never matched and every session spawned another. Read once and drop
  // it, so nothing this server starts inherits it.
  const spawnedAsPrimary = process.env.MONOMIND_CONTROL_PRIMARY === '1';
  delete process.env.MONOMIND_CONTROL_PRIMARY;
  async function writeDashboardToken(actualPort) {
    try {
      actualPort = Number(actualPort);
      const authFileDir = path.join(projectDir || process.cwd(), '.monomind');
      fs.mkdirSync(authFileDir, { recursive: true });
      // Primary = control.json absent/invalid, or it names this port, or
      // nothing answers on the port it names (stale record from a previous
      // run). Liveness is an HTTP probe, not a pid check — control-start may
      // record pid 0 for adopted servers, and dead pids get recycled; a probe
      // is authoritative either way. Anything answering on the claimed port
      // means "don't clobber" (conservative on ambiguity).
      let primary = true;
      try {
        const ctl = JSON.parse(fs.readFileSync(path.join(authFileDir, 'control.json'), 'utf8'));
        const ctlPort = Number(ctl.port || (String(ctl.url || '').match(/:(\d+)/) || [])[1]);
        if (
          !spawnedAsPrimary &&
          ctlPort &&
          ctlPort !== actualPort &&
          !(Number.isInteger(ctl.pid) && ctl.pid === process.pid)
        ) {
          // A single 800ms probe is not enough evidence to declare the record
          // stale: on a loaded host the primary's event loop can be blocked for
          // seconds (heavy search/KG work, parallel test suites), the probe
          // times out, and a secondary would wrongly claim primary and CLOBBER
          // the live server's token — the exact failure this gate exists to
          // prevent. Retry before concluding "nothing answering" so the gate
          // stays conservative on ambiguity.
          for (let attempt = 0; attempt < 3 && primary; attempt++) {
            try {
              await fetch(`http://127.0.0.1:${ctlPort}/api/status`, {
                signal: AbortSignal.timeout(1500),
              });
              primary = false; // something answered — a live server owns the primary token
            } catch (_) {
              if (attempt < 2) await new Promise((r) => setTimeout(r, 250));
            }
          }
          // The probes can all time out while the primary is alive but busy
          // for longer than they wait (a loaded CI host: the secondary then
          // clobbered the primary's token and never wrote its own). A live
          // recorded pid still means "don't clobber"; a recycled pid only errs
          // towards the port-scoped token, and control-start rewrites
          // control.json when it starts a new primary.
          if (primary && Number.isInteger(ctl.pid) && ctl.pid > 0) {
            try {
              process.kill(ctl.pid, 0);
              primary = false;
            } catch (err) {
              if (err?.code === 'EPERM') primary = false; // alive, owned by someone else
            }
          }
        }
      } catch (_) {
        /* no readable control.json — treat as primary */
      }
      const tokenPath = path.join(
        authFileDir,
        primary ? 'dashboard-token' : `dashboard-token-${actualPort}`,
      );
      fs.writeFileSync(tokenPath, dashboardAuthValue, { mode: 0o600 });
      fs.chmodSync(tokenPath, 0o600); // enforce on rewrite — {mode} above is create-only
      tokenState.path = tokenPath;
      // Sweep stale secondary tokens (dead scratch/test instances) so they
      // don't accumulate as orphaned credential files.
      // Age-based sweep — the belt-and-braces backstop for a dirty death
      // (kill -9) that never reaches shutdown()'s cleanup below.
      try {
        const weekMs = 7 * 24 * 3600 * 1000;
        for (const f of fs.readdirSync(authFileDir)) {
          if (!/^dashboard-token-\d+$/.test(f) || f === `dashboard-token-${actualPort}`) continue;
          const fp = path.join(authFileDir, f);
          if (Date.now() - fs.statSync(fp).mtimeMs > weekMs) fs.unlinkSync(fp);
        }
      } catch (_) {}
    } catch (_) {}
  }
  // i-052 commit 4: this is the code path that actually planted
  // dashboard-token in the incident's other repos — a paired project may
  // never have run `init` (so it never got commits 1-2's `.gitignore`
  // coverage) yet still receives a live token here on every restart.
  // Ensures the SAME coverage `init` would have given it before writing
  // the token, content-guarded exactly like write-runtime-config.ts's
  // append (creates the file if absent; appends the one missing line if
  // present; no-ops if already covered) — duplicated locally rather than
  // imported because this file ships as plain ESM with no build step and
  // cannot import compiled TypeScript (see monoes-mcp-entry.mjs's own doc
  // comment for the identical constraint). Best-effort: a coverage-ensure
  // failure must never block token delivery, which is the more urgent
  // property (a stale token 401s every cross-project caller).
  function ensureDashboardTokenGitignoreCoverage(kpMonoDir) {
    try {
      const gitignorePath = path.join(kpMonoDir, '.gitignore');
      const reason =
        'live monomind dashboard credential (i-052) — grants cross-project file reads and agent execution; rewritten on every dashboard restart, so an already-tracked path re-commits a fresh live token on every restart';
      if (!fs.existsSync(gitignorePath)) {
        fs.mkdirSync(kpMonoDir, { recursive: true });
        fs.writeFileSync(gitignorePath, `# ${reason}\ndashboard-token\n`);
        return;
      }
      const existing = fs.readFileSync(gitignorePath, 'utf8');
      const existingLines = new Set(existing.split('\n').map((l) => l.trim()));
      if (!existingLines.has('dashboard-token')) {
        fs.writeFileSync(gitignorePath, `${existing.trimEnd()}\n# ${reason}\ndashboard-token\n`);
      }
    } catch (_) {
      /* best effort — see doc comment above */
    }
  }

  // Propagate the fresh token to every known project whose control.json points
  // at this server — otherwise each restart silently orphans cross-project
  // callers (their curls/CLI reads a stale token and 401s forever). The
  // population is `data/known-projects.json`'s own content, never a
  // directory glob (i-052 owner correction: the incident's affected-repo
  // count included projects outside any assumed directory layout).
  // Called after bind so the match uses the ACTUAL bound port.
  function propagateDashboardToken(actualPort) {
    try {
      const _kpFile = path.join(projectDir || process.cwd(), 'data', 'known-projects.json');
      if (!fs.existsSync(_kpFile)) return;
      for (const _kp of JSON.parse(fs.readFileSync(_kpFile, 'utf8'))) {
        try {
          const _kpMono = path.join(_kp, '.monomind');
          const _kpCtl = JSON.parse(fs.readFileSync(path.join(_kpMono, 'control.json'), 'utf8'));
          // Only pair projects that direct their traffic to this server's port.
          if (_kpCtl && _controlUrlPort(_kpCtl.url) === Number(actualPort)) {
            ensureDashboardTokenGitignoreCoverage(_kpMono);
            const _kpTokenPath = path.join(_kpMono, 'dashboard-token');
            fs.writeFileSync(_kpTokenPath, dashboardAuthValue, { mode: 0o600 });
            fs.chmodSync(_kpTokenPath, 0o600); // enforce on rewrite — {mode} above is create-only
          }
        } catch (_) {
          /* project missing/unreadable — skip */
        }
      }
    } catch (_) {}
  }
  return { writeDashboardToken, propagateDashboardToken, tokenState };
}

export { createDashboardTokenManager };
