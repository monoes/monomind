/**
 * Production Monitoring and Observability
 *
 * Provides monitoring hooks for:
 * - Request/response metrics
 * - Error tracking
 * - Performance monitoring
 * - Health checks
 * - Alerting
 *
 * @module @monoes/cli/production/monitoring
 */
export type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';
export interface MetricEvent {
    name: string;
    type: MetricType;
    value: number;
    labels: Record<string, string>;
    timestamp: number;
}
export interface MonitorConfig {
    enabled: boolean;
    retentionMs: number;
    maxMetrics: number;
    samplingRate: number;
    alertThresholds: Record<string, {
        warning: number;
        critical: number;
    }>;
    healthCheckIntervalMs: number;
    reportingEndpoint?: string;
    globalLabels: Record<string, string>;
}
export interface HealthStatus {
    healthy: boolean;
    checks: Record<string, {
        status: 'healthy' | 'degraded' | 'unhealthy';
        message?: string;
        lastCheck: number;
        responseTimeMs?: number;
    }>;
    timestamp: number;
}
export interface PerformanceMetrics {
    requestCount: number;
    errorCount: number;
    errorRate: number;
    avgResponseTimeMs: number;
    p50ResponseTimeMs: number;
    p95ResponseTimeMs: number;
    p99ResponseTimeMs: number;
    activeRequests: number;
    uptime: number;
}
type AlertLevel = 'info' | 'warning' | 'critical';
interface Alert {
    id: string;
    level: AlertLevel;
    metric: string;
    message: string;
    value: number;
    threshold: number;
    timestamp: number;
    acknowledged: boolean;
}
export declare class MonitoringHooks {
    private config;
    private metrics;
    private responseTimes;
    private alerts;
    private healthStatus;
    private startTime;
    private activeRequests;
    private requestCount;
    private errorCount;
    private healthChecks;
    constructor(config?: Partial<MonitorConfig>);
    /**
     * Record a counter metric
     */
    counter(name: string, value?: number, labels?: Record<string, string>): void;
    /**
     * Record a gauge metric
     */
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record a histogram metric
     */
    histogram(name: string, value: number, labels?: Record<string, string>): void;
    /**
     * Record a metric event
     */
    private recordMetric;
    /**
     * Start tracking a request
     */
    startRequest(requestId: string): () => void;
    /**
     * Record an error
     */
    recordError(error: Error, labels?: Record<string, string>): void;
    /**
     * Register a health check
     */
    registerHealthCheck(name: string, check: () => Promise<{
        healthy: boolean;
        message?: string;
    }>): void;
    /**
     * Run all health checks
     */
    runHealthChecks(): Promise<HealthStatus>;
    /**
     * Get current health status
     */
    getHealthStatus(): HealthStatus;
    /**
     * Get performance metrics
     */
    getPerformanceMetrics(): PerformanceMetrics;
    /**
     * Get active alerts
     */
    getAlerts(level?: AlertLevel): Alert[];
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId: string): boolean;
    /**
     * Clear all alerts
     */
    clearAlerts(): void;
    /**
     * Get metrics for a specific name
     */
    getMetrics(name: string, since?: number): MetricEvent[];
    /**
     * Get all metrics summary
     */
    getMetricsSummary(): Record<string, {
        count: number;
        lastValue: number;
        avgValue: number;
    }>;
    /**
     * Reset all metrics
     */
    reset(): void;
    private checkAlerts;
    private cleanupMetrics;
}
/**
 * Create or get the default monitor
 */
export declare function createMonitor(config?: Partial<MonitorConfig>): MonitoringHooks;
/**
 * Get the default monitor
 */
export declare function getMonitor(): MonitoringHooks;
export default MonitoringHooks;
//# sourceMappingURL=monitoring.d.ts.map