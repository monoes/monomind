/**
 * Contract Registry
 *
 * Extracts HTTP contracts (Route nodes) from per-repo monograph databases,
 * identifies cross-repo links (same method + path in 2+ repos), and
 * persists/loads the registry in a SQLite database.
 */

import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import Database from 'better-sqlite3';

// ── Public types ──────────────────────────────────────────────────────────────

export interface HttpContract {
  method: string;
  path: string;
  handlerName: string | null;
  handlerFile: string | null;
  repo: string;
}

export interface ContractLink {
  path: string;
  method: string;
  producerRepo: string;
  consumerRepos: string[];
}

// ── Internal types ────────────────────────────────────────────────────────────

interface RouteRow {
  name: string;
  file_path: string | null;
  handler_name: string | null;
  handler_file: string | null;
}

interface ContractRow {
  method: string;
  path: string;
  handler_name: string | null;
  handler_file: string | null;
  repo: string;
}

interface LinkRow {
  path: string;
  method: string;
  producer_repo: string;
  consumer_repos: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse a Route node name (format: "METHOD /path") into method and path.
 * Falls back gracefully if the format is unexpected.
 */
function parseRouteName(name: string): { method: string; path: string } {
  const spaceIdx = name.indexOf(' ');
  if (spaceIdx === -1) {
    return { method: 'ANY', path: name };
  }
  return {
    method: name.slice(0, spaceIdx),
    path: name.slice(spaceIdx + 1),
  };
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Extract all HTTP contracts (Route nodes) from a monograph database.
 *
 * Route nodes store method and path together in the `name` field as
 * `"METHOD /path"` (e.g., "GET /api/users"). The handler info is obtained by
 * following HANDLES_ROUTE edges where the Route node is the SOURCE.
 *
 * @param db       - Open better-sqlite3 database handle (read-only acceptable)
 * @param repoName - Logical name for this repo (used to tag returned contracts)
 * @returns Array of HttpContract objects
 */
export function extractHttpContracts(db: Database.Database, repoName: string): HttpContract[] {
  // Route is the source of HANDLES_ROUTE edges; handler is the target.
  const rows = db
    .prepare(
      `SELECT
         r.name        AS name,
         r.file_path   AS file_path,
         n.name        AS handler_name,
         n.file_path   AS handler_file
       FROM nodes r
       LEFT JOIN edges e ON e.source_id = r.id AND e.relation = 'HANDLES_ROUTE'
       LEFT JOIN nodes n ON n.id = e.target_id
       WHERE r.label = 'Route'`,
    )
    .all() as RouteRow[];

  return rows.map((row) => {
    const { method, path } = parseRouteName(row.name);
    return {
      method,
      path,
      handlerName: row.handler_name ?? null,
      handlerFile: row.handler_file ?? null,
      repo: repoName,
    };
  });
}

/**
 * Group contracts by (method + path) and identify cross-repo links.
 *
 * A ContractLink is produced for every (method, path) pair that appears in
 * 2 or more repos. The first repo encountered for a given pair is treated as
 * the "producer"; all others become consumers. Repos are deduplicated via Set
 * so a repo appearing multiple times (e.g., two handlers for the same route)
 * is counted only once.
 *
 * @param contracts - Flat list of contracts from all repos
 * @returns Cross-repo contract links
 */
export function buildContractLinks(contracts: HttpContract[]): ContractLink[] {
  // key → ordered unique repos (first seen = producer)
  const grouped = new Map<string, { repoOrder: string[]; repoSet: Set<string> }>();

  for (const c of contracts) {
    const key = `${c.method} ${c.path}`;
    const existing = grouped.get(key);
    if (existing) {
      if (!existing.repoSet.has(c.repo)) {
        existing.repoSet.add(c.repo);
        existing.repoOrder.push(c.repo);
      }
    } else {
      grouped.set(key, { repoOrder: [c.repo], repoSet: new Set([c.repo]) });
    }
  }

  const links: ContractLink[] = [];
  for (const [key, { repoOrder }] of grouped) {
    if (repoOrder.length >= 2) {
      const spaceIdx = key.indexOf(' ');
      links.push({
        method: key.slice(0, spaceIdx),
        path: key.slice(spaceIdx + 1),
        producerRepo: repoOrder[0],
        consumerRepos: repoOrder.slice(1),
      });
    }
  }

  return links;
}

/**
 * Persist the contract registry to a SQLite file, overwriting any existing data.
 *
 * Tables created:
 *   - contracts (method, path, handler_name, handler_file, repo)
 *   - links     (path, method, producer_repo, consumer_repos TEXT — JSON array)
 *
 * @param registryPath - Absolute path to the target .contracts.db file
 * @param links        - Cross-repo contract links to store
 * @param contracts    - All individual contracts to store
 */
export function saveContractRegistry(
  registryPath: string,
  links: ContractLink[],
  contracts: HttpContract[],
): void {
  mkdirSync(dirname(registryPath), { recursive: true });

  const db = new Database(registryPath);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        method       TEXT NOT NULL,
        path         TEXT NOT NULL,
        handler_name TEXT,
        handler_file TEXT,
        repo         TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS links (
        path           TEXT NOT NULL,
        method         TEXT NOT NULL,
        producer_repo  TEXT NOT NULL,
        consumer_repos TEXT NOT NULL
      );
    `);

    // Overwrite existing data
    db.exec(`DELETE FROM contracts; DELETE FROM links;`);

    const insertContract = db.prepare(
      `INSERT INTO contracts (method, path, handler_name, handler_file, repo)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const insertLink = db.prepare(
      `INSERT INTO links (path, method, producer_repo, consumer_repos)
       VALUES (?, ?, ?, ?)`,
    );

    const storeAll = db.transaction(() => {
      for (const c of contracts) {
        insertContract.run(c.method, c.path, c.handlerName, c.handlerFile, c.repo);
      }
      for (const l of links) {
        insertLink.run(l.path, l.method, l.producerRepo, JSON.stringify(l.consumerRepos));
      }
    });

    storeAll();
  } finally {
    db.close();
  }
}

/**
 * Load a previously saved contract registry from disk.
 *
 * @param registryPath - Absolute path to the .contracts.db file
 * @returns Parsed contracts and links, or null if the file does not exist
 */
export function loadContractRegistry(
  registryPath: string,
): { contracts: HttpContract[]; links: ContractLink[] } | null {
  if (!existsSync(registryPath)) {
    return null;
  }

  const db = new Database(registryPath, { readonly: true });
  try {
    const contractRows = db
      .prepare(`SELECT method, path, handler_name, handler_file, repo FROM contracts`)
      .all() as ContractRow[];

    const linkRows = db
      .prepare(`SELECT path, method, producer_repo, consumer_repos FROM links`)
      .all() as LinkRow[];

    const contracts: HttpContract[] = contractRows.map((r) => ({
      method: r.method,
      path: r.path,
      handlerName: r.handler_name,
      handlerFile: r.handler_file,
      repo: r.repo,
    }));

    const links: ContractLink[] = linkRows.map((r) => ({
      path: r.path,
      method: r.method,
      producerRepo: r.producer_repo,
      consumerRepos: JSON.parse(r.consumer_repos) as string[],
    }));

    return { contracts, links };
  } finally {
    db.close();
  }
}
