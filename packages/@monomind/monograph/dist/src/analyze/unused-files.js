import { isDeclarationFile, isConfigFile, isHtmlFile } from "./predicates/file.js";
export function findUnusedFiles(allFiles, reachableFiles, opts = {}) {
    const { skipDeclarations = true, skipConfig = true, skipHtml = true } = opts;
    return allFiles
        .filter((filePath) => !reachableFiles.has(filePath))
        .filter((filePath) => {
        if (skipDeclarations && isDeclarationFile(filePath))
            return false;
        if (skipConfig && isConfigFile(filePath))
            return false;
        if (skipHtml && isHtmlFile(filePath))
            return false;
        return true;
    })
        .map((filePath) => ({
        filePath,
        reason: "not reachable from any entry point",
    }));
}
export function hasReachableImporter(filePath, importers, reachable) {
    const fileImporters = importers.get(filePath);
    if (!fileImporters)
        return false;
    for (const importer of fileImporters) {
        if (reachable.has(importer))
            return true;
    }
    return false;
}
//# sourceMappingURL=unused-files.js.map