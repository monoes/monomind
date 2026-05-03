export type RuntimeCoverageVerdict =
  | 'SafeToDelete'
  | 'ReviewRequired'
  | 'CoverageUnavailable'
  | 'LowTraffic'
  | 'Active'
  | 'Unknown';

export type RuntimeCoverageRiskBand = 'Critical' | 'High' | 'Medium' | 'Low';

export type RuntimeCoverageAction = 'Delete' | 'Review' | 'Keep' | 'Monitor';

export interface RuntimeSignal {
  filePath: string;
  requestsPerDay?: number;
  lastSeenDaysAgo?: number;
}

export interface RuntimeCoverageReportVerdict {
  path: string;
  staticVerdict: 'unused' | 'used' | 'unknown';
  runtimeVerdict: RuntimeCoverageVerdict;
  riskBand: RuntimeCoverageRiskBand;
  recommendedAction: RuntimeCoverageAction;
}

export function classifyRuntimeVerdict(
  signal: RuntimeSignal | undefined
): RuntimeCoverageVerdict {
  if (signal === undefined) return 'CoverageUnavailable';
  if (signal.requestsPerDay === 0) return 'LowTraffic';
  if (signal.lastSeenDaysAgo !== undefined && signal.lastSeenDaysAgo > 30) return 'LowTraffic';
  if (signal.requestsPerDay !== undefined && signal.requestsPerDay > 10) return 'Active';
  return 'Unknown';
}

export function classifyRiskBand(
  staticVerdict: string,
  runtimeVerdict: RuntimeCoverageVerdict
): RuntimeCoverageRiskBand {
  if (staticVerdict === 'unused') {
    if (runtimeVerdict === 'LowTraffic' || runtimeVerdict === 'CoverageUnavailable') return 'Critical';
    if (runtimeVerdict === 'Unknown') return 'High';
    if (runtimeVerdict === 'Active') return 'Medium';
  }
  return 'Low';
}

export function recommendAction(
  riskBand: RuntimeCoverageRiskBand,
  runtimeVerdict: RuntimeCoverageVerdict
): RuntimeCoverageAction {
  if (riskBand === 'Critical') {
    if (runtimeVerdict === 'LowTraffic') return 'Delete';
    return 'Review';
  }
  if (riskBand === 'High') return 'Review';
  if (riskBand === 'Medium') return 'Monitor';
  return 'Keep';
}

export function classifyRuntimeCoverage(
  path: string,
  staticVerdict: 'unused' | 'used' | 'unknown',
  signal?: RuntimeSignal
): RuntimeCoverageReportVerdict {
  const runtimeVerdict = classifyRuntimeVerdict(signal);
  const riskBand = classifyRiskBand(staticVerdict, runtimeVerdict);
  const recommendedAction = recommendAction(riskBand, runtimeVerdict);
  return { path, staticVerdict, runtimeVerdict, riskBand, recommendedAction };
}
