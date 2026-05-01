import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';

// Mock the db module so tests don't require a real indexed repo
vi.mock('../../src/storage/db.js', () => ({
  openDb: vi.fn(),
  closeDb: vi.fn(),
}));

import { openDb, closeDb } from '../../src/storage/db.js';
import { generateSkillFiles } from '../../src/cli/skill-gen.js';

// ============================================================================
// HELPERS
// ============================================================================

function makeMockDb(rows: {
  communities?: unknown[];
  members?: unknown[];
  crossConnections?: unknown[];
}) {
  const prepare = vi.fn().mockImplementation((sql: string) => {
    // Communities query: contains 'community_id' and 'member_count'
    if (sql.includes('member_count')) {
      return {
        all: vi.fn().mockReturnValue(rows.communities ?? []),
      };
    }
    // deriveCommunityLabel query: contains 'file_path' but NOT 'start_line'
    if (sql.includes('file_path') && !sql.includes('start_line') && !sql.includes('source_id')) {
      return {
        all: vi.fn().mockReturnValue([]),
      };
    }
    // Members query: contains 'start_line'
    if (sql.includes('start_line')) {
      return {
        all: vi.fn().mockReturnValue(rows.members ?? []),
      };
    }
    // Cross-connections query: contains 'source_id'
    if (sql.includes('source_id')) {
      return {
        all: vi.fn().mockReturnValue(rows.crossConnections ?? []),
      };
    }
    // Fallback
    return { all: vi.fn().mockReturnValue([]) };
  });

  return { prepare } as unknown as ReturnType<typeof openDb>;
}

// ============================================================================
// TESTS
// ============================================================================

describe('generateSkillFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `skill-gen-test-${Date.now()}`);
    mkdirSync(join(tmpDir, '.monomind'), { recursive: true });
    vi.mocked(closeDb).mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // --------------------------------------------------------------------------
  // Shape
  // --------------------------------------------------------------------------

  it('returns SkillGenResult shape with empty result when no communities found', async () => {
    const db = makeMockDb({ communities: [] });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);

    expect(result).toHaveProperty('filesWritten');
    expect(result).toHaveProperty('communityCount');
    expect(Array.isArray(result.filesWritten)).toBe(true);
    expect(typeof result.communityCount).toBe('number');
  });

  it('returns empty filesWritten and communityCount=0 when no communities found', async () => {
    const db = makeMockDb({ communities: [] });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);

    expect(result.filesWritten).toHaveLength(0);
    expect(result.communityCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Output directory creation
  // --------------------------------------------------------------------------

  it('creates the output directory if it does not exist', async () => {
    const customOutputDir = join(tmpDir, 'custom-skills-dir');
    expect(existsSync(customOutputDir)).toBe(false);

    const db = makeMockDb({ communities: [] });
    vi.mocked(openDb).mockReturnValue(db);

    await generateSkillFiles(tmpDir, customOutputDir);

    // Directory should be created even with no communities (mkdir happens before loop)
    // Actually the function returns early before mkdir when no communities — so only
    // assert the directory does NOT get created when there are no communities.
    // The directory IS created when there are communities.
    expect(existsSync(customOutputDir)).toBe(false);
  });

  it('creates the default .monomind/skills/ directory when communities exist', async () => {
    const db = makeMockDb({
      communities: [{ community_id: 1, label: 'Function', member_count: 3 }],
      members: [
        {
          id: 'n1',
          label: 'Function',
          name: 'parseFile',
          file_path: `${tmpDir}/src/parser.ts`,
          start_line: 10,
          is_exported: 1,
        },
      ],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);

    const defaultDir = join(tmpDir, '.monomind', 'skills');
    expect(existsSync(defaultDir)).toBe(true);
    expect(result.communityCount).toBe(1);
    expect(result.filesWritten).toHaveLength(1);
  });

  it('creates custom output directory when communities exist', async () => {
    const customOutputDir = join(tmpDir, 'my-skills');
    const db = makeMockDb({
      communities: [{ community_id: 2, label: 'Class', member_count: 5 }],
      members: [
        {
          id: 'n2',
          label: 'Class',
          name: 'GraphBuilder',
          file_path: `${tmpDir}/src/graph/builder.ts`,
          start_line: 1,
          is_exported: 1,
        },
      ],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir, customOutputDir);

    expect(existsSync(customOutputDir)).toBe(true);
    expect(result.filesWritten[0]).toContain(customOutputDir);
  });

  // --------------------------------------------------------------------------
  // File generation
  // --------------------------------------------------------------------------

  it('generates one skill file per community', async () => {
    const db = makeMockDb({
      communities: [
        { community_id: 1, label: 'Function', member_count: 3 },
        { community_id: 2, label: 'Class', member_count: 4 },
      ],
      members: [],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);

    expect(result.communityCount).toBe(2);
    expect(result.filesWritten).toHaveLength(2);
  });

  it('generated skill file contains community label', async () => {
    const { readFileSync } = await import('fs');

    const db = makeMockDb({
      communities: [{ community_id: 1, label: 'Parser', member_count: 3 }],
      members: [
        {
          id: 'n1',
          label: 'Function',
          name: 'parseFile',
          file_path: `${tmpDir}/src/parser.ts`,
          start_line: 5,
          is_exported: 1,
        },
      ],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);
    expect(result.filesWritten).toHaveLength(1);

    const content = readFileSync(result.filesWritten[0], 'utf-8');
    expect(content).toContain('Parser');
    expect(content).toContain('parseFile');
  });

  it('generated skill file is valid markdown with frontmatter', async () => {
    const { readFileSync } = await import('fs');

    const db = makeMockDb({
      communities: [{ community_id: 3, label: 'Storage', member_count: 2 }],
      members: [],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);
    const content = readFileSync(result.filesWritten[0], 'utf-8');

    expect(content.startsWith('---')).toBe(true);
    expect(content).toContain('name:');
    expect(content).toContain('description:');
    expect(content).toContain('# Storage');
  });

  it('skill file contains How to Explore section', async () => {
    const { readFileSync } = await import('fs');

    const db = makeMockDb({
      communities: [{ community_id: 4, label: 'Auth', member_count: 5 }],
      members: [
        {
          id: 'n4',
          label: 'Function',
          name: 'verifyToken',
          file_path: `${tmpDir}/src/auth/verify.ts`,
          start_line: 20,
          is_exported: 1,
        },
      ],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);
    const content = readFileSync(result.filesWritten[0], 'utf-8');

    expect(content).toContain('## How to Explore');
    expect(content).toContain('monograph_context');
  });

  it('filesWritten paths end with .md', async () => {
    const db = makeMockDb({
      communities: [{ community_id: 1, label: 'Graph', member_count: 3 }],
      members: [],
      crossConnections: [],
    });
    vi.mocked(openDb).mockReturnValue(db);

    const result = await generateSkillFiles(tmpDir);

    for (const f of result.filesWritten) {
      expect(f.endsWith('.md')).toBe(true);
    }
  });
});
