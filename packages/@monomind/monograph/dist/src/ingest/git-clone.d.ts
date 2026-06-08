/**
 * Git Clone Utility with SSRF Protection
 *
 * Shallow-clones repositories into ~/.monograph/repos/{name}/.
 * If already cloned, runs `git pull --ff-only` instead.
 *
 * SSRF protection: only https:// and http:// are allowed,
 * and private/internal IP ranges are blocked.
 */
/**
 * Validate a git URL to prevent SSRF attacks.
 *
 * Blocks:
 * - Non-http(s) schemes
 * - Private IPv4 ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, etc.)
 * - IPv6 private ranges (::1, fc00::/7, fe80::/10, ::ffff:...)
 * - Cloud metadata hostnames
 * - Numeric IP encodings (decimal/hex)
 *
 * @throws {Error} with a descriptive message if the URL is not safe.
 */
export declare function validateGitUrl(url: string): void;
/**
 * Extract the repository name from an HTTPS or SSH git URL.
 *
 * @example
 * extractRepoName('https://github.com/org/repo.git') // 'repo'
 * extractRepoName('git@github.com:org/repo.git')     // 'repo'
 */
export declare function extractRepoName(url: string): string;
/**
 * Get the default clone target directory for a repository name.
 * Repositories are stored in `~/.monograph/repos/{repoName}`.
 */
export declare function getCloneDir(repoName: string): string;
export interface CloneProgress {
    phase: 'cloning' | 'pulling';
    message: string;
}
/**
 * Clone or pull a git repository with SSRF protection.
 *
 * - If `targetDir/.git` does not exist: `git clone --depth 1 <url> <targetDir>`
 * - If `targetDir/.git` exists: `git pull --ff-only`
 *
 * The URL is validated against SSRF rules before any network operation.
 *
 * @param url       - The git remote URL (must be https:// or http://).
 * @param targetDir - Local directory to clone into.
 * @param onProgress - Optional progress callback.
 * @returns Resolves to `targetDir` on success.
 */
export declare function cloneOrPull(url: string, targetDir: string, onProgress?: (progress: CloneProgress) => void): Promise<string>;
//# sourceMappingURL=git-clone.d.ts.map