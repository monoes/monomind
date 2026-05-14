/**
 * Google Cloud Storage Backend
 * Real storage implementation using gcloud CLI or GCS APIs
 *
 * @module @monoes/cli/transfer/storage/gcs
 * @version 3.0.0
 */
/**
 * GCS configuration
 */
export interface GCSConfig {
    bucket: string;
    projectId?: string;
    keyFile?: string;
    prefix?: string;
}
/**
 * GCS upload result
 */
export interface GCSUploadResult {
    success: boolean;
    uri: string;
    publicUrl: string;
    size: number;
    checksum: string;
    contentId: string;
}
/**
 * Get GCS configuration from environment
 */
export declare function getGCSConfig(): GCSConfig | null;
/**
 * Check if gcloud CLI is available
 */
export declare function isGCloudAvailable(): boolean;
/**
 * Check if authenticated with gcloud
 */
export declare function isGCloudAuthenticated(): Promise<boolean>;
/**
 * Upload content to Google Cloud Storage using gcloud CLI
 */
export declare function uploadToGCS(content: Buffer, options?: {
    name?: string;
    contentType?: string;
    config?: GCSConfig;
    metadata?: Record<string, string>;
}): Promise<GCSUploadResult>;
/**
 * Download content from Google Cloud Storage
 */
export declare function downloadFromGCS(uri: string, config?: GCSConfig): Promise<Buffer | null>;
/**
 * Check if object exists in GCS
 */
export declare function existsInGCS(uri: string, config?: GCSConfig): Promise<boolean>;
/**
 * List objects in GCS bucket with prefix
 */
export declare function listGCSObjects(prefix?: string, config?: GCSConfig): Promise<Array<{
    name: string;
    size: number;
    updated: string;
}>>;
/**
 * Delete object from GCS
 */
export declare function deleteFromGCS(uri: string, config?: GCSConfig): Promise<boolean>;
/**
 * Get GCS storage status
 */
export declare function getGCSStatus(): {
    available: boolean;
    authenticated: boolean;
    bucket?: string;
    message: string;
};
/**
 * Export for storage backend detection
 */
export declare function hasGCSCredentials(): boolean;
//# sourceMappingURL=gcs.d.ts.map