export function trendArrow(d) {
    return d === 'improving' ? '↑' : d === 'declining' ? '↓' : '→';
}
export function trendColor(d) {
    return d === 'improving' ? '\x1b[32m' : d === 'declining' ? '\x1b[31m' : '\x1b[33m';
}
export function computeOverallDirection(metrics) {
    if (metrics.length === 0)
        return 'stable';
    const improving = metrics.filter(m => m.direction === 'improving').length;
    const declining = metrics.filter(m => m.direction === 'declining').length;
    if (improving > declining)
        return 'improving';
    if (declining > improving)
        return 'declining';
    return 'stable';
}
export function formatTrendMetric(m) {
    const sign = m.delta >= 0 ? '+' : '';
    const arrow = trendArrow(m.direction);
    return `${m.label}: ${m.previous}${m.unit} → ${m.current}${m.unit} (${sign}${m.delta.toFixed(1)}${m.unit}) ${arrow}`;
}
//# sourceMappingURL=trend-types.js.map