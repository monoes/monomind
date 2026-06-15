/**
 * Pattern Publish Service
 * Publish and contribute patterns to decentralized registry
 */
import * as fs from 'fs';
import * as crypto from 'crypto';
import { DEFAULT_STORE_CONFIG, generatePatternId } from './registry.js';
import { anonymizeCFP } from '../anonymization/index.js';
import { uploadToIPFS, pinContent } from '../ipfs/upload.js';
/**
 * Pattern Publisher
 * Handles publishing patterns to IPFS and registry
 */
export class PatternPublisher {
    config;
    constructor(config = {}) {
        this.config = { ...DEFAULT_STORE_CONFIG, ...config };
    }
    /**
     * Publish a pattern to IPFS and registry
     */
    async publishPattern(cfp, options) {
        console.log(`[Publish] Starting publish: ${options.name}`);
        try {
            // Step 1: Anonymize if needed
            const anonymized = anonymizeCFP(cfp, options.anonymize);
            console.log(`[Publish] Anonymization level: ${options.anonymize}`);
            // Step 2: Serialize content
            const content = JSON.stringify(anonymized, null, 2);
            const contentBuffer = Buffer.from(content);
            // Step 3: Calculate checksum
            const checksum = crypto
                .createHash('sha256')
                .update(contentBuffer)
                .digest('hex');
            // Step 4: Sign if private key provided
            let signature;
            let publicKey;
            if (options.privateKeyPath && fs.existsSync(options.privateKeyPath)) {
                const signResult = await this.signContent(contentBuffer, options.privateKeyPath);
                signature = signResult.signature;
                publicKey = signResult.publicKey;
                console.log(`[Publish] Content signed`);
            }
            // Get author info early (needed for GCS metadata and pattern entry)
            const author = this.getAuthor();
            // Step 5: Upload to IPFS or GCS
            let uploadCid;
            let gatewayUrl;
            // Check if GCS is configured
            try {
                const { hasGCSCredentials, uploadToGCS } = await import('../storage/gcs.js');
                if (hasGCSCredentials()) {
                    console.log(`[Publish] Uploading to Google Cloud Storage...`);
                    const gcsResult = await uploadToGCS(contentBuffer, {
                        name: `${options.name}.cfp.json`,
                        metadata: {
                            checksum,
                            author: author.id,
                            version: cfp.version,
                        },
                    });
                    if (gcsResult.success) {
                        uploadCid = gcsResult.uri; // Use GCS URI as CID
                        gatewayUrl = gcsResult.publicUrl;
                        console.log(`[Publish] Uploaded to GCS: ${gcsResult.uri}`);
                    }
                    else {
                        throw new Error('GCS upload failed');
                    }
                }
                else {
                    throw new Error('GCS not configured');
                }
            }
            catch {
                // Fallback to IPFS
                console.log(`[Publish] Uploading to IPFS...`);
                const uploadResult = await uploadToIPFS(contentBuffer, {
                    name: `${options.name}.cfp.json`,
                    pin: true,
                });
                if (!uploadResult.cid) {
                    return {
                        success: false,
                        patternId: '',
                        cid: '',
                        registryCid: '',
                        gatewayUrl: '',
                        message: 'Failed to upload to IPFS (no IPFS credentials configured)',
                    };
                }
                uploadCid = uploadResult.cid;
                gatewayUrl = `${this.config.gateway}/ipfs/${uploadResult.cid}`;
                console.log(`[Publish] Uploaded to IPFS: ${uploadResult.cid}`);
                // Pin content
                await pinContent(uploadResult.cid);
            }
            // Step 6: Create pattern entry
            const patternId = generatePatternId(options.name);
            const patternEntry = {
                id: patternId,
                name: options.name,
                displayName: options.displayName,
                description: options.description,
                version: cfp.version,
                cid: uploadCid,
                size: contentBuffer.length,
                checksum,
                author,
                license: options.license,
                categories: options.categories,
                tags: options.tags,
                language: options.language,
                framework: options.framework,
                downloads: 0,
                rating: 0,
                ratingCount: 0,
                lastUpdated: new Date().toISOString(),
                createdAt: new Date().toISOString(),
                minMonomindVersion: '3.0.0',
                verified: author.verified,
                trustLevel: author.verified ? 'verified' : 'community',
                signature,
                publicKey,
            };
            // Step 7: Add to registry (in production: submit to registry maintainers)
            console.log(`[Publish] Pattern entry created: ${patternId}`);
            return {
                success: true,
                patternId,
                cid: uploadCid,
                registryCid: '', // Would be updated after registry update
                gatewayUrl,
                message: `Pattern '${options.displayName}' published successfully!`,
            };
        }
        catch (error) {
            console.error(`[Publish] Failed:`, error);
            // Sanitize error message: strip control chars and cap length to prevent
            // internal paths / stack traces from leaking into CLI output or logs.
            const rawMsg = error instanceof Error ? error.message : String(error);
            const safeMsg = rawMsg.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 256);
            return {
                success: false,
                patternId: '',
                cid: '',
                registryCid: '',
                gatewayUrl: '',
                message: `Publish failed: ${safeMsg}`,
            };
        }
    }
    /**
     * Sign content with Ed25519 private key
     */
    async signContent(content, privateKeyPath) {
        const ed = await import('@noble/ed25519');
        // Guard: cap key file size to prevent OOM on oversized or malicious files.
        // A valid 32-byte Ed25519 seed encoded as hex is 64 chars; even with a
        // newline and BOM the file should never exceed a few hundred bytes.
        const MAX_KEY_FILE_BYTES = 4 * 1024; // 4 KB — generous upper bound
        const keyFileStat = fs.statSync(privateKeyPath);
        if (keyFileStat.size > MAX_KEY_FILE_BYTES) {
            throw new Error(`Private key file exceeds size limit (${MAX_KEY_FILE_BYTES} bytes)`);
        }
        const keyHex = fs.readFileSync(privateKeyPath, 'utf-8').trim();
        // Accept 64-char hex (32-byte seed) directly; otherwise derive via SHA-256
        const privKeyBytes = keyHex.length === 64
            ? Buffer.from(keyHex, 'hex')
            : crypto.createHash('sha256').update(keyHex).digest();
        const pubKeyBytes = await ed.getPublicKeyAsync(privKeyBytes);
        const sigBytes = await ed.signAsync(content, privKeyBytes);
        return {
            signature: 'ed25519:' + Buffer.from(sigBytes).toString('hex'),
            publicKey: 'ed25519:' + Buffer.from(pubKeyBytes).toString('hex'),
        };
    }
    /**
     * Get current author info
     */
    getAuthor() {
        if (this.config.authorId) {
            return {
                id: this.config.authorId,
                displayName: this.config.authorId,
                verified: false,
                patterns: 0,
                totalDownloads: 0,
            };
        }
        // Anonymous author
        return {
            id: `anon-${crypto.randomBytes(8).toString('hex')}`,
            verified: false,
            patterns: 0,
            totalDownloads: 0,
        };
    }
    /**
     * Validate pattern before publish
     */
    validateForPublish(cfp, options) {
        const errors = [];
        // Check required fields
        if (!options.name || options.name.length < 3) {
            errors.push('Name must be at least 3 characters');
        }
        if (!options.displayName || options.displayName.length < 3) {
            errors.push('Display name must be at least 3 characters');
        }
        if (!options.description || options.description.length < 20) {
            errors.push('Description must be at least 20 characters');
        }
        if (!options.categories || options.categories.length === 0) {
            errors.push('At least one category is required');
        }
        if (!options.tags || options.tags.length < 3) {
            errors.push('At least 3 tags are required');
        }
        // Check valid license
        const validLicenses = ['MIT', 'Apache-2.0', 'GPL-3.0', 'BSD-3-Clause', 'CC-BY-4.0', 'Unlicense'];
        if (!validLicenses.includes(options.license)) {
            errors.push(`License must be one of: ${validLicenses.join(', ')}`);
        }
        // Check pattern content
        if (cfp.magic !== 'CFP1') {
            errors.push('Invalid CFP format (missing magic header)');
        }
        const totalPatterns = cfp.statistics.totalPatterns;
        if (totalPatterns === 0) {
            errors.push('Pattern must contain at least one pattern');
        }
        return errors;
    }
    /**
     * Create publish preview
     */
    createPreview(cfp, options) {
        return {
            name: options.name,
            displayName: options.displayName,
            description: options.description,
            categories: options.categories,
            tags: options.tags,
            license: options.license,
            language: options.language,
            framework: options.framework,
            anonymization: options.anonymize,
            statistics: cfp.statistics,
            estimatedSize: JSON.stringify(cfp).length,
        };
    }
}
/**
 * Submit a contribution to the registry
 */
export async function submitContribution(request) {
    console.log(`[Contribute] Submitting contribution: ${request.name}`);
    // In production: Submit to registry governance system
    // For demo: Generate mock submission ID
    const submissionId = `contrib-${crypto.randomBytes(8).toString('hex')}`;
    console.log(`[Contribute] Submission ID: ${submissionId}`);
    console.log(`[Contribute] Pattern CID: ${request.patternCid}`);
    console.log(`[Contribute] Author: ${request.authorId}`);
    return {
        success: true,
        submissionId,
        message: `Contribution submitted for review. Track status with ID: ${submissionId}`,
    };
}
/**
 * Check contribution status
 */
export async function checkContributionStatus(submissionId) {
    // In production: Query registry governance system
    // For demo: Return mock status
    return {
        status: 'pending',
        message: 'Your contribution is pending review',
    };
}
/**
 * Create publisher with default config
 */
export function createPublisher(config) {
    return new PatternPublisher(config);
}
/**
 * Quick publish helper
 */
export async function quickPublish(cfp, name, description, tags, config) {
    const publisher = new PatternPublisher(config);
    const options = {
        name,
        displayName: name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        description,
        categories: ['custom'],
        tags,
        license: 'MIT',
        anonymize: 'standard',
    };
    return publisher.publishPattern(cfp, options);
}
//# sourceMappingURL=publish.js.map