import { isDeclarationFile, isConfigFile, isHtmlFile } from "./predicates/file.js";

export interface UnusedFileResult {
  filePath: string;
  reason: string;
}

export interface FindUnusedFilesOptions {
  skipDeclarations?: boolean;
  skipConfig?: boolean;
  skipHtml?: boolean;
}

export function findUnusedFiles(
  allFiles: string[],
  reachableFiles: Set<string>,
  opts: FindUnusedFilesOptions = {}
): UnusedFileResult[] {
  const { skipDeclarations = true, skipConfig = true, skipHtml = true } = opts;

  return allFiles
    .filter((filePath) => !reachableFiles.has(filePath))
    .filter((filePath) => {
      if (skipDeclarations && isDeclarationFile(filePath)) return false;
      if (skipConfig && isConfigFile(filePath)) return false;
      if (skipHtml && isHtmlFile(filePath)) return false;
      return true;
    })
    .map((filePath) => ({
      filePath,
      reason: "not reachable from any entry point",
    }));
}

export function hasReachableImporter(
  filePath: string,
  importers: Map<string, Set<string>>,
  reachable: Set<string>
): boolean {
  const fileImporters = importers.get(filePath);
  if (!fileImporters) return false;
  for (const importer of fileImporters) {
    if (reachable.has(importer)) return true;
  }
  return false;
}
