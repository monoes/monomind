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
 * @module @monomind/cli/production/monitoring
 */
/** Metric type discriminator. */
export type MetricType = 'counter' | 'gauge' | 'histogram';
/** Alert severity level. */
export type AlertLevel = 'warning' | 'critical';
/** Health check status discriminator. */
export type HealthCheckStatus = 'healthy' | 'unhealthy';
/** A single recorded metric event. */
export interface MetricEvent {
    name: string;
    type: MetricType;
    value: number;
    labels: Record<string, string>;
    timestamp: number;
}
/** Warning/critical thresholds for a single metric. */
export interface AlertThreshold {
    warning: number;
    critical: number;
}
/** Configuration for the monitoring hooks. */
export interface MonitorConfig {
    enabled: boolean;
    retentionMs: number;
    maxMetrics: number;
    samplingRate: number;
    alertThresholds: Record<string, AlertThreshold>;
    healthCheckIntervalMs: number;
    globalLabels: Record<string, string>;
}
/** An active or acknowledged alert. */
export interface Alert {
    id: string;
    level: AlertLevel;
    metric: string;
    message: string;
    value: number;
    threshold: number;
    timestamp: number;
    acknowledged: boolean;
}
/** Result returned by a registered health check function. */
export interface HealthCheckResult {
    healthy: boolean;
    message?: string;
}
/** A user-supplied health check. */
export type HealthCheck = () => Promise<HealthCheckResult>;
/** Per-check entry within an aggregated health status. */
export interface HealthCheckEntry {
    status: HealthCheckStatus;
    message?: string;
    lastCheck: number;
    responseTimeMs: number;
}
/** Aggregated health status across all registered checks. */
export interface HealthStatus {
    healthy: boolean;
    checks: Record<string, HealthCheckEntry>;
    timestamp: number;
}
/** Snapshot of performance metrics derived from recorded data. */
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
/** Aggregated summary entry for a single metric name. */
export interface MetricSummaryEntry {
    count: number;
    lastValue: number;
    avgValue: number;
}
/** Function returned by {@link MonitoringHooks.startRequest} to end tracking. */
export type EndRequest = () => void;
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
    recordMetric(name: string, type: MetricType, value: number, labels: Record<string, string>): void;
    /**
     * Start tracking a request
     */
    startRequest(requestId?: string): EndRequest;
    /**
     * Record an error
     */
    recordError(error: Error, labels?: Record<string, string>): void;
    /**
     * Register a health check
     */
    registerHealthCheck(name: string, check: HealthCheck): void;
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
    getMetricsSummary(): Record<string, MetricSummaryEntry>;
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