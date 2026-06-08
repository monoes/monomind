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
export declare function getCommunitiesResource(db: Database.Database): CommunitiesResourceData;
//# sourceMappingURL=communities-resource.d.ts.map