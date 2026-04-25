import { readdirSync, readFileSync, statSync } from 'fs';
import { join, extname, relative, dirname } from 'path';
const DEFAULT_MAX_FILE_SIZE = 500 * 1024; // 500KB
const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.monobrain',
    '__pycache__', '.pytest_cache', 'target', '.cache',
]);
// Maps file extension to [fileType, language]
const EXTENSION_MAP = {
    '.ts': ['code', 'typescript'], '.tsx': ['code', 'typescript'],
    '.mts': ['code', 'typescript'], '.cts': ['code', 'typescript'],
    '.js': ['code', 'javascript'], '.jsx': ['code', 'javascript'],
    '.mjs': ['code', 'javascript'], '.cjs': ['code', 'javascript'],
    '.py': ['code', 'python'], '.go': ['code', 'go'],
    '.rs': ['code', 'rust'], '.java': ['code', 'java'],
    '.c': ['code', 'c'], '.cpp': ['code', 'cpp'],
    '.h': ['code', 'c'], '.cs': ['code', 'csharp'],
    '.rb': ['code', 'ruby'], '.php': ['code', 'php'],
    '.swift': ['code', 'swift'], '.kt': ['code', 'kotlin'],
    '.scala': ['code', 'scala'], '.md': ['document', 'markdown'],
    '.txt': ['document', 'text'], '.rst': ['document', 'rst'],
};
// Patterns matching filenames/paths that may contain credentials or secrets.
// Matched against both the basename and the relative path.
const SECURITY_SENSITIVE_PATTERNS = [
    // .env files
    /^\.env(\.|$)/i,
    /[/\\]\.env(\.|$)/i,
    // PEM / key files
    /\.(pem|key|p12|pfx)$/i,
    // SSH private keys
    /\b(id_rsa|id_dsa|id_ecdsa|id_ed25519)(\.[^/\\]*)?$/i,
    // Credential / secret JSON / YAML
    /\bcredentials\.json$/i,
    /\bsecrets?\.(json|ya?ml)$/i,
    // AWS
    /\baws-credentials$/i,
    /[/\\]\.aws[/\\]credentials$/i,
    // GCP / Firebase
    /\bservice-?account\.json$/i,
    /\bclient_secret\.json$/i,
    /\bgoogle-credentials\.json$/i,
    /\bfirebase[^/\\]*\.json$/i,
    // Auth-related
    /\bprivate\.key$/i,
    /\bprivate_key\.json$/i,
    /\.htpasswd$/i,
    /\bshadow$/i,
    /\bvault-token$/i,
    /\.token$/i,
    /\bauth\.json$/i,
    // Package auth files
    /\.npmrc$/i,
    /\.pypirc$/i,
    /\bnetrc$/i,
    /\.pgpass$/i,
];
/** Returns true if the given basename or relative path matches any security-sensitive pattern. */
function isSecuritySensitive(basename, relPath) {
    return SECURITY_SENSITIVE_PATTERNS.some((re) => re.test(basename) || re.test(relPath));
}
/**
 * Converts a .graphifyignore pattern line into a RegExp.
 * Escapes regex special chars then converts `*` to `.*`.
 */
function patternToRegex(pattern) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(escaped);
}
/**
 * Walks up the directory tree from rootPath to the filesystem root,
 * collecting patterns from any `.graphifyignore` files found along the way.
 * Lines beginning with `#` are comments; blank lines are skipped.
 * Returns the combined list of pattern strings (closest dir first).
 */
export function loadIgnorePatterns(rootPath) {
    const patterns = [];
    let current = rootPath;
    while (true) {
        const candidate = join(current, '.graphifyignore');
        try {
            const contents = readFileSync(candidate, 'utf8');
            for (const line of contents.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    patterns.push(trimmed);
                }
            }
        }
        catch {
            // File does not exist or is unreadable at this level — continue walking up
        }
        const parent = dirname(current);
        if (parent === current)
            break; // reached filesystem root
        current = parent;
    }
    return patterns;
}
/**
 * Recursively collects and classifies all files under rootPath, applying
 * exclusion rules for directories, file size limits, security-sensitive filenames,
 * .graphifyignore patterns, and optional language filtering from BuildOptions.
 */
export function collectFiles(rootPath, options = {}) {
    const maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    const codeOnly = options.codeOnly ?? false;
    const languageFilter = options.languages ? new Set(options.languages) : null;
    const excludePatterns = options.excludePatterns ?? [];
    // Load .graphifyignore patterns and compile to regexes
    const ignorePatternStrings = loadIgnorePatterns(rootPath);
    const ignoreRegexes = ignorePatternStrings.map(patternToRegex);
    const results = [];
    function walkDir(dirPath) {
        let entries;
        try {
            entries = readdirSync(dirPath);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const fullPath = join(dirPath, entry);
            const relPath = relative(rootPath, fullPath);
            // Check against caller-supplied exclude patterns
            if (excludePatterns.some((pat) => relPath.includes(pat)))
                continue;
            // Check against .graphifyignore patterns
            if (ignoreRegexes.some((re) => re.test(relPath)))
                continue;
            let stat;
            try {
                stat = statSync(fullPath);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                if (EXCLUDED_DIRS.has(entry))
                    continue;
                walkDir(fullPath);
                continue;
            }
            if (!stat.isFile())
                continue;
            if (stat.size > maxFileSizeBytes)
                continue;
            // Skip security-sensitive files
            if (isSecuritySensitive(entry, relPath))
                continue;
            const ext = extname(entry).toLowerCase();
            const mapping = EXTENSION_MAP[ext];
            if (!mapping)
                continue;
            const [fileType, language] = mapping;
            if (codeOnly && fileType !== 'code')
                continue;
            if (languageFilter && !languageFilter.has(language))
                continue;
            results.push({ path: fullPath, fileType, language, sizeBytes: stat.size });
        }
    }
    walkDir(rootPath);
    return results;
}
/**
 * Analyses a collected file corpus and returns a list of human-readable warning
 * strings describing potential issues. Returns an empty array when the corpus
 * looks healthy.
 */
export function corpusHealth(files) {
    const warnings = [];
    const codeFiles = files.filter((f) => f.fileType === 'code');
    const docFiles = files.filter((f) => f.fileType === 'document');
    const totalSize = files.reduce((sum, f) => sum + f.sizeBytes, 0);
    if (codeFiles.length < 5) {
        warnings.push(`Corpus is very small (${codeFiles.length} code files). Graph may be sparse.`);
    }
    if (totalSize < 50_000) {
        const kb = Math.round(totalSize / 1024);
        warnings.push(`Corpus total size is very small (~${kb}KB). Consider including more source files.`);
    }
    if (totalSize > 50_000_000) {
        const mb = Math.round(totalSize / (1024 * 1024));
        warnings.push(`Corpus is very large (~${mb}MB). Build may be slow. Consider using codeOnly or excludePatterns.`);
    }
    if (docFiles.length === 0) {
        warnings.push('No documentation files found. Graph will have no document nodes.');
    }
    if (files.length > 0 && docFiles.length / files.length > 0.8) {
        warnings.push('Corpus is mostly documentation. Consider codeOnly: true for a code-focused graph.');
    }
    return warnings;
}
//# sourceMappingURL=detect.js.map