import type Database from 'better-sqlite3';

export interface CommunityMember {
  name: string;
  label: string;
  filePath: string | null;
}

export interface CommunityEntry {
  id: number;
  label: string | null;
  memberCount: number;
  topMembers: CommunityMember[];
}

export interface CommunitiesResourceData {
  communities: CommunityEntry[];
}

/**
 * Returns all community clusters with their member symbols.
 * Pulls community metadata from the communities table and top 5 members
 * (by name, alphabetical) from the nodes table.
 */
export function getCommunitiesResource(db: Database.Database): CommunitiesResourceData {
  // Get all communities with their member counts from nodes
  const communityRows = db
    .prepare(
      `SELECT n.community_id, c.label, COUNT(*) AS member_count
       FROM nodes n
       LEFT JOIN communities c ON c.id = n.community_id
       WHERE n.community_id IS NOT NULL
       GROUP BY n.community_id
       ORDER BY member_count DESC`,
    )
    .all() as Array<{
    community_id: number;
    label: string | null;
    member_count: number;
  }>;

  const topMembersQuery = db.prepare(
    `SELECT name, label, file_path
     FROM nodes
     WHERE community_id = ?
     ORDER BY name
     LIMIT 5`,
  );

  const communities: CommunityEntry[] = communityRows.map((row) => {
    const memberRows = topMembersQuery.all(row.community_id) as Array<{
      name: string;
      label: string;
      file_path: string | null;
    }>;

    const topMembers: CommunityMember[] = memberRows.map((m) => ({
      name: m.name,
      label: m.label,
      filePath: m.file_path,
    }));

    return {
      id: row.community_id,
      label: row.label,
      memberCount: row.member_count,
      topMembers,
    };
  });

  return { communities };
}
