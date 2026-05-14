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
// ============================================================================
// Default Configuration
// ============================================================================
const DEFAULT_CONFIG = {
    enabled: true,
    retentionMs: 3600000, // 1 hour
    maxMetrics: 100000,
    samplingRate: 1.0,
    alertThresholds: {
        'error_rate': { warning: 0.05, critical: 0.1 },
        'response_time_ms': { warning: 1000, critical: 5000 },
        'active_requests': { warning: 100, critical: 500 },
    },
    healthCheckIntervalMs: 30000,
    globalLabels: {},
};
// ============================================================================
// Monitoring Implementation
// ============================================================================
export class MonitoringHooks {
    config;
    metrics = [];
    responseTimes = [];
    alerts = [];
    healthStatus;
    startTime = Date.now();
    activeRequests = 0;
    requestCount = 0;
    errorCount = 0;
    healthChecks = new Map();
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.healthStatus = {
            healthy: true,
            checks: {},
            timestamp: Date.now(),
        };
    }
    // ============================================================================
    // Metrics Collection
    // ============================================================================
    /**
     * Record a counter metric
     */
    counter(name, value = 1, labels = {}) {
        this.recordMetric(name, 'counter', value, labels);
    }
    /**
     * Record a gauge metric
     */
    gauge(name, value, labels = {}) {
        this.recordMetric(name, 'gauge', value, labels);
    }
    /**
     * Record a histogram metric
     */
    histogram(name, value, labels = {}) {
        this.recordMetric(name, 'histogram', value, labels);
    }
    /**
     * Record a metric event
     */
    recordMetric(name, type, value, labels) {
        if (!this.config.enabled)
            return;
        // Apply sampling
        if (Math.random() > this.config.samplingRate)
            return;
        const event = {
            name,
            type,
            value,
            labels: { ...this.config.globalLabels, ...labels },
            timestamp: Date.now(),
        };
        this.metrics.push(event);
        // Check alerts
        this.checkAlerts(name, value);
        // Cleanup old metrics
        this.cleanupMetrics();
    }
    // ============================================================================
    // Request Tracking
    // ============================================================================
    /**
     * Start tracking a request
     */
    startRequest(requestId) {
        this.activeRequests++;
        this.requestCount++;
        const startTime = Date.now();
        this.counter('request_started', 1, {});
        // Return end function
        return () => {
            this.activeRequests--;
            const duration = Date.now() - startTime;
            this.responseTimes.push(duration);
            this.histogram('response_time_ms', duration, {});
            // Keep only last 1000 response times
            if (this.responseTimes.length > 1000) {
                this.responseTimes = this.responseTimes.slice(-1000);
            }
        };
    }
    /**
     * Record an error
     */
    recordError(error, labels = {}) {
        this.errorCount++;
        this.counter('error', 1, {
            ...labels,
            errorType: error.name,
        });
    }
    // ============================================================================
    // Health Checks
    // ============================================================================
    /**
     * Register a health check
     */
    registerHealthCheck(name, check) {
        this.healthChecks.set(name, check);
    }
    /**
     * Run all health checks
     */
    async runHealthChecks() {
        const checks = {};
        let allHealthy = true;
        for (const [name, check] of this.healthChecks) {
            const startTime = Date.now();
            try {
                const result = await check();
                checks[name] = {
                    status: result.healthy ? 'healthy' : 'unhealthy',
                    message: result.message,
                    lastCheck: Date.now(),
                    responseTimeMs: Date.now() - startTime,
                };
                if (!result.healthy)
                    allHealthy = false;
            }
            catch (error) {
                checks[name] = {
                    status: 'unhealthy',
                    message: error.message,
                    lastCheck: Date.now(),
                    responseTimeMs: Date.now() - startTime,
                };
                allHealthy = false;
            }
        }
        this.healthStatus = {
            healthy: allHealthy,
            checks,
            timestamp: Date.now(),
        };
        return this.healthStatus;
    }
    /**
     * Get current health status
     */
    getHealthStatus() {
        return this.healthStatus;
    }
    // ============================================================================
    // Performance Metrics
    // ============================================================================
    /**
     * Get performance metrics
     */
    getPerformanceMetrics() {
        const sortedTimes = [...this.responseTimes].sort((a, b) => a - b);
        const count = sortedTimes.length;
        const percentile = (p) => {
            if (count === 0)
                return 0;
            const index = Math.ceil(count * p) - 1;
            return sortedTimes[Math.min(index, count - 1)];
        };
        const avgResponseTime = count > 0
            ? sortedTimes.reduce((a, b) => a + b, 0) / count
            : 0;
        return {
            requestCount: this.requestCount,
            errorCount: this.errorCount,
            errorRate: this.requestCount > 0 ? this.errorCount / this.requestCount : 0,
            avgResponseTimeMs: Math.round(avgResponseTime),
            p50ResponseTimeMs: percentile(0.5),
            p95ResponseTimeMs: percentile(0.95),
            p99ResponseTimeMs: percentile(0.99),
            activeRequests: this.activeRequests,
            uptime: Date.now() - this.startTime,
        };
    }
    // ============================================================================
    // Alerting
    // ============================================================================
    /**
     * Get active alerts
     */
    getAlerts(level) {
        let filtered = this.alerts.filter(a => !a.acknowledged);
        if (level) {
            filtered = filtered.filter(a => a.level === level);
        }
        return filtered;
    }
    /**
     * Acknowledge an alert
     */
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            return true;
        }
        return false;
    }
    /**
     * Clear all alerts
     */
    clearAlerts() {
        this.alerts = [];
    }
    // ============================================================================
    // Data Export
    // ============================================================================
    /**
     * Get metrics for a specific name
     */
    getMetrics(name, since) {
        let filtered = this.metrics.filter(m => m.name === name);
        if (since) {
            filtered = filtered.filter(m => m.timestamp >= since);
        }
        return filtered;
    }
    /**
     * Get all metrics summary
     */
    getMetricsSummary() {
        const summary = {};
        for (const metric of this.metrics) {
            if (!summary[metric.name]) {
                summary[metric.name] = { count: 0, sum: 0, lastValue: 0 };
            }
            summary[metric.name].count++;
            summary[metric.name].sum += metric.value;
            summary[metric.name].lastValue = metric.value;
        }
        const result = {};
        for (const [name, data] of Object.entries(summary)) {
            result[name] = {
                count: data.count,
                lastValue: data.lastValue,
                avgValue: data.count > 0 ? data.sum / data.count : 0,
            };
        }
        return result;
    }
    /**
     * Reset all metrics
     */
    reset() {
        this.metrics = [];
        this.responseTimes = [];
        this.alerts = [];
        this.requestCount = 0;
        this.errorCount = 0;
        this.activeRequests = 0;
        this.startTime = Date.now();
    }
    // ============================================================================
    // Private Methods
    // ============================================================================
    checkAlerts(name, value) {
        const thresholds = this.config.alertThresholds[name];
        if (!thresholds)
            return;
        let level = null;
        let threshold = 0;
        if (value >= thresholds.critical) {
            level = 'critical';
            threshold = thresholds.critical;
        }
        else if (value >= thresholds.warning) {
            level = 'warning';
            threshold = thresholds.warning;
        }
        if (level) {
            // Check if we already have a recent alert for this metric
            const recentAlert = this.alerts.find(a => a.metric === name &&
                !a.acknowledged &&
                Date.now() - a.timestamp < 60000);
            if (!recentAlert) {
                this.alerts.push({
                    id: `alert_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                    level,
                    metric: name,
                    message: `${name} exceeded ${level} threshold: ${value} >= ${threshold}`,
                    value,
                    threshold,
                    timestamp: Date.now(),
                    acknowledged: false,
                });
            }
        }
    }
    cleanupMetrics() {
        const now = Date.now();
        const cutoff = now - this.config.retentionMs;
        // Remove old metrics
        this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
        // Limit total metrics
        if (this.metrics.length > this.config.maxMetrics) {
            this.metrics = this.metrics.slice(-this.config.maxMetrics);
        }
        // Remove old acknowledged alerts
        this.alerts = this.alerts.filter(a => !a.acknowledged || Date.now() - a.timestamp < 300000);
        // Cap total alerts to prevent unbounded growth
        const MAX_ALERTS = 500;
        if (this.alerts.length > MAX_ALERTS) {
            this.alerts = this.alerts.slice(-MAX_ALERTS);
        }
    }
}
// ============================================================================
// Convenience Functions
// ============================================================================
let defaultMonitor = null;
/**
 * Create or get the default monitor
 */
export function createMonitor(config) {
    if (!defaultMonitor) {
        defaultMonitor = new MonitoringHooks(config);
    }
    return defaultMonitor;
}
/**
 * Get the default monitor
 */
export function getMonitor() {
    return createMonitor();
}
export default MonitoringHooks;
//# sourceMappingURL=monitoring.js.map