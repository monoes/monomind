/**
 * Google Cloud Storage Backend
 * Real storage implementation using gcloud CLI or GCS APIs
 *
 * @module @monomind/cli/transfer/storage/gcs
 * @version 3.0.0
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
/**
 * Get GCS configuration from environment
 */
export function getGCSConfig() {
    const bucket = process.env.GCS_BUCKET || process.env.GOOGLE_CLOUD_BUCKET;
    if (!bucket)
        return null;
    return {
        bucket,
        projectId: process.env.GCS_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
        prefix: process.env.GCS_PREFIX || 'monomind-patterns',
    };
}
/**
 * Validate GCS bucket name (prevents command injection via bucket names)
 */
function isValidBucketName(bucket) {
    return /^[a-z0-9][a-z0-9._-]{1,221}[a-z0-9]$/.test(bucket);
}
/**
 * Validate GCS object path (no shell metacharacters)
 */
function isValidObjectPath(objectPath) {
    return /^[a-zA-Z0-9_.\/\-]+$/.test(objectPath);
}
/**
 * Check if gcloud CLI is available
 */
export function isGCloudAvailable() {
    try {
        execFileSync('gcloud', ['--version'], { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if authenticated with gcloud
 */
export async function isGCloudAuthenticated() {
    try {
        execFileSync('gcloud', ['auth', 'print-access-token'], { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Generate content ID from content hash
 */
function generateContentId(content) {
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return `cfp-${hash.slice(0, 16)}`;
}
/**
 * Upload content to Google Cloud Storage using gcloud CLI
 */
export async function uploadToGCS(content, options = {}) {
    const config = options.config || getGCSConfig();
    if (!config) {
        throw new Error('GCS not configured. Set GCS_BUCKET environment variable.\n' +
            'Or authenticate: gcloud auth login && gcloud config set project YOUR_PROJECT');
    }
    const contentId = generateContentId(content);
    const checksum = crypto.createHash('sha256').update(content).digest('hex');
    const fileName = options.name || `${contentId}.cfp.json`;
    // Validate filename to prevent path traversal
    if (!/^[a-zA-Z0-9._\-]+$/.test(fileName) || fileName.includes('..')) {
        throw new Error(`Invalid filename: ${fileName}`);
    }
    const objectPath = config.prefix ? `${config.prefix}/${fileName}` : fileName;
    // S-1: Validate bucket name and object path to prevent command injection
    if (!isValidBucketName(config.bucket)) {
        throw new Error(`Invalid GCS bucket name: ${config.bucket}`);
    }
    if (!isValidObjectPath(objectPath)) {
        throw new Error(`Invalid GCS object path: ${objectPath}`);
    }
    console.log(`[GCS] Uploading to gs://${config.bucket}/${objectPath}...`);
    // Write content to temp file
    const tempDir = process.env.TMPDIR || '/tmp';
    const tempFile = path.join(tempDir, `monomind-upload-${crypto.randomUUID()}.json`);
    // wx flag = O_CREAT | O_EXCL — fails if path exists (symlink-attack defense)
    fs.writeFileSync(tempFile, content, { flag: 'wx', mode: 0o600 });
    try {
        // Build gcloud args (array form prevents shell injection)
        const uploadArgs = ['storage', 'cp', tempFile, `gs://${config.bucket}/${objectPath}`];
        if (config.projectId)
            uploadArgs.push(`--project=${config.projectId}`);
        uploadArgs.push(`--content-type=${options.contentType || 'application/json'}`);
        execFileSync('gcloud', uploadArgs, { encoding: 'utf-8', stdio: 'pipe', timeout: 60000 });
        // Set metadata if provided
        if (options.metadata && Object.keys(options.metadata).length > 0) {
            // Cap metadata to prevent unbounded flag values; restrict key charset to
            // alphanumeric/dash/underscore to avoid injection in --custom-metadata=<json>.
            const MAX_META_KEY_LEN = 128;
            const MAX_META_VAL_LEN = 512;
            const MAX_META_ENTRIES = 20;
            const safeMetadata = {};
            let metaCount = 0;
            for (const [k, v] of Object.entries(options.metadata)) {
                if (metaCount >= MAX_META_ENTRIES)
                    break;
                if (typeof k !== 'string' || typeof v !== 'string')
                    continue;
                if (!/^[a-zA-Z0-9_-]+$/.test(k))
                    continue;
                safeMetadata[k.slice(0, MAX_META_KEY_LEN)] = v.slice(0, MAX_META_VAL_LEN);
                metaCount++;
            }
            const metadataJson = JSON.stringify(safeMetadata);
            try {
                const metaArgs = ['storage', 'objects', 'update', `gs://${config.bucket}/${objectPath}`, `--custom-metadata=${metadataJson}`];
                if (config.projectId)
                    metaArgs.push(`--project=${config.projectId}`);
                execFileSync('gcloud', metaArgs, { encoding: 'utf-8', stdio: 'pipe', timeout: 60000 });
            }
            catch {
                // Metadata update failed, but upload succeeded
            }
        }
        // Clean up temp file (validate path is within temp dir)
        const resolvedTemp = path.resolve(tempFile);
        if (resolvedTemp.startsWith(path.resolve(tempDir))) {
            fs.unlinkSync(tempFile);
        }
        const uri = `gs://${config.bucket}/${objectPath}`;
        const publicUrl = `https://storage.googleapis.com/${config.bucket}/${objectPath}`;
        console.log(`[GCS] Upload complete: ${uri}`);
        return {
            success: true,
            uri,
            publicUrl,
            size: content.length,
            checksum,
            contentId,
        };
    }
    catch (error) {
        // Clean up temp file on error (validate path is within temp dir)
        try {
            const resolvedTemp = path.resolve(tempFile);
            if (resolvedTemp.startsWith(path.resolve(tempDir))) {
                fs.unlinkSync(tempFile);
            }
        }
        catch { /* ignore */ }
        throw new Error(`GCS upload failed: ${error}`);
    }
}
/**
 * Download content from Google Cloud Storage
 */
export async function downloadFromGCS(uri, config) {
    const cfg = config || getGCSConfig();
    console.log(`[GCS] Downloading from ${uri}...`);
    // Write to temp file first
    const tempDir = process.env.TMPDIR || '/tmp';
    const tempFile = path.join(tempDir, `monomind-download-${crypto.randomUUID()}.json`);
    if (!uri.startsWith('gs://')) {
        console.error('[GCS] Invalid URI: must start with gs://');
        return null;
    }
    try {
        // Download using gcloud storage cp; '--' prevents URI from being parsed as a flag
        const downloadArgs = ['storage', 'cp', '--', uri, tempFile];
        if (cfg?.projectId)
            downloadArgs.push(`--project=${cfg.projectId}`);
        execFileSync('gcloud', downloadArgs, { encoding: 'utf-8', stdio: 'pipe' });
        const MAX_GCS_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
        const fileSize = fs.statSync(tempFile).size;
        if (fileSize > MAX_GCS_DOWNLOAD_BYTES) {
            const resolvedTemp2 = path.resolve(tempFile);
            if (resolvedTemp2.startsWith(path.resolve(tempDir)))
                fs.unlinkSync(tempFile);
            console.error(`[GCS] Downloaded file exceeds size limit (${fileSize} > ${MAX_GCS_DOWNLOAD_BYTES} bytes)`);
            return null;
        }
        const content = fs.readFileSync(tempFile);
        const resolvedTemp = path.resolve(tempFile);
        if (resolvedTemp.startsWith(path.resolve(tempDir))) {
            fs.unlinkSync(tempFile);
        }
        console.log(`[GCS] Downloaded ${content.length} bytes`);
        return content;
    }
    catch (error) {
        try {
            const resolvedTemp = path.resolve(tempFile);
            if (resolvedTemp.startsWith(path.resolve(tempDir))) {
                fs.unlinkSync(tempFile);
            }
        }
        catch { /* ignore */ }
        console.error(`[GCS] Download failed: ${error}`);
        return null;
    }
}
/**
 * Check if object exists in GCS
 */
export async function existsInGCS(uri, config) {
    const cfg = config || getGCSConfig();
    if (!uri.startsWith('gs://'))
        return false;
    try {
        const lsArgs = ['storage', 'ls', '--', uri];
        if (cfg?.projectId)
            lsArgs.push(`--project=${cfg.projectId}`);
        execFileSync('gcloud', lsArgs, { encoding: 'utf-8', stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * List objects in GCS bucket with prefix
 */
export async function listGCSObjects(prefix, config) {
    const cfg = config || getGCSConfig();
    if (!cfg)
        return [];
    const objectPrefix = prefix || cfg.prefix || '';
    const uri = `gs://${cfg.bucket}/${objectPrefix}`;
    try {
        const listArgs = ['storage', 'ls', '-l', uri, '--format=json'];
        if (cfg.projectId)
            listArgs.push(`--project=${cfg.projectId}`);
        const result = execFileSync('gcloud', listArgs, { encoding: 'utf-8', stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });
        // Guard against gcloud returning a huge JSON payload that could OOM Node.
        const MAX_LIST_BYTES = 10 * 1024 * 1024; // 10 MB
        if (result.length > MAX_LIST_BYTES) {
            console.error(`[GCS] listGCSObjects response too large (${result.length} bytes), truncating`);
            return [];
        }
        const objects = JSON.parse(result);
        if (!Array.isArray(objects))
            return [];
        return objects.slice(0, 10_000).map((obj) => ({
            name: obj.name,
            size: obj.size || 0,
            updated: obj.updated || new Date().toISOString(),
        }));
    }
    catch {
        return [];
    }
}
/**
 * Delete object from GCS
 */
export async function deleteFromGCS(uri, config) {
    const cfg = config || getGCSConfig();
    if (!uri.startsWith('gs://'))
        return false;
    try {
        const rmArgs = ['storage', 'rm', '--', uri];
        if (cfg?.projectId)
            rmArgs.push(`--project=${cfg.projectId}`);
        execFileSync('gcloud', rmArgs, { encoding: 'utf-8', stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Get GCS storage status
 */
export function getGCSStatus() {
    const config = getGCSConfig();
    const gcloudAvailable = isGCloudAvailable();
    if (!gcloudAvailable) {
        return {
            available: false,
            authenticated: false,
            message: 'gcloud CLI not installed. Install from: https://cloud.google.com/sdk/docs/install',
        };
    }
    if (!config?.bucket) {
        return {
            available: true,
            authenticated: false,
            message: 'GCS bucket not configured. Set GCS_BUCKET environment variable.',
        };
    }
    return {
        available: true,
        authenticated: true,
        bucket: config.bucket,
        message: `GCS configured with bucket: ${config.bucket}`,
    };
}
/**
 * Export for storage backend detection
 */
export function hasGCSCredentials() {
    return !!getGCSConfig() && isGCloudAvailable();
}
//# sourceMappingURL=gcs.js.map