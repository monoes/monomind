/**
 * Skill File Generator
 *
 * Generates per-community skill/context files that describe a code community's
 * purpose, top symbols, and relationships. These files help AI agents navigate
 * large codebases by providing curated summaries per architectural boundary.
 */
export interface SkillGenResult {
    filesWritten: string[];
    communityCount: number;
}
/**
 * Generate per-community skill files from the Monograph knowledge graph.
 *
 * @param repoPath - Absolute path to the repository root
 * @param outputDir - Output directory for skill files (default: .monomind/skills/)
 * @returns Metadata about the generated files
 */
export declare function generateSkillFiles(repoPath: string, outputDir?: string): Promise<SkillGenResult>;
//# sourceMappingURL=skill-gen.d.ts.map