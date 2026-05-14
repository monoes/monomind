export const DEFAULT_RETRY_POLICY = {
    maxAttempts: 3,
    initialDelayMs: 1000,
    backoffMultiplier: 2.0,
    jitterMs: 500,
    retryOn: ['RATE_LIMIT', 'TIMEOUT'],
};
//# sourceMappingURL=dag-types.js.map