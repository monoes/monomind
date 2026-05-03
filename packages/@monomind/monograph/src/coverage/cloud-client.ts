// Types and stub for fetching production runtime coverage from a remote API.

export type CloudRuntimeRiskBand = 'hot' | 'warm' | 'cold' | 'unknown';
export type CloudTrackingState = 'tracked' | 'untracked' | 'partial';
export type CloudRuntimeWarning = 'low_traffic' | 'short_window' | 'partial_coverage';

export interface CloudRuntimeBlastRadiusEntry {
  callerName: string;
  callerFile: string;
  callerLine: number;
  trafficWeight: number;
}

export interface CloudRuntimeImportanceEntry {
  name: string;
  filePath: string;
  importanceScore: number;
}

export interface CloudRuntimeFunction {
  name: string;
  filePath: string;
  startLine: number;
  hitCount: number;
  riskBand: CloudRuntimeRiskBand;
  importanceScore: number;
  blastRadius: CloudRuntimeBlastRadiusEntry[];
}

export interface CloudRuntimeSummary {
  totalFunctions: number;
  hotFunctions: number;
  coldFunctions: number;
  unknownFunctions: number;
  observationWindowDays: number;
  trackingState: CloudTrackingState;
  warnings: CloudRuntimeWarning[];
}

export interface CloudRuntimeContext {
  projectId: string;
  environment: string;
  commitSha?: string;
  period: string;
  summary: CloudRuntimeSummary;
  functions: CloudRuntimeFunction[];
  importanceEntries: CloudRuntimeImportanceEntry[];
}

export type CloudErrorKind =
  | 'AuthError'
  | 'TierRequired'
  | 'NetworkError'
  | 'ValidationError'
  | 'NotFound'
  | 'RateLimited';

export interface CloudError {
  kind: CloudErrorKind;
  message: string;
  exitCode: number;
}

export interface CloudRequest {
  projectId: string;
  environment?: string;
  commitSha?: string;
  period?: string;
  apiKey?: string;
  apiBase?: string;
}

/** Build the URL for a cloud runtime context request. */
export function buildCloudRequestUrl(base: string, req: CloudRequest): string {
  const params = new URLSearchParams();
  if (req.environment) params.set('environment', req.environment);
  if (req.commitSha) params.set('commit_sha', req.commitSha);
  if (req.period) params.set('period', req.period);
  const qs = params.toString();
  const encoded = encodeURIComponent(req.projectId);
  return `${base}/projects/${encoded}/runtime-context${qs ? '?' + qs : ''}`;
}

/** Fetch runtime coverage context from the cloud API (stub — real impl requires HTTP client). */
export async function fetchRuntimeContext(
  req: CloudRequest,
): Promise<CloudRuntimeContext | CloudError> {
  const base = req.apiBase ?? 'https://api.fallow.cloud/v1';
  const url = buildCloudRequestUrl(base, req);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${req.apiKey ?? ''}`,
        Accept: 'application/json',
      },
    });
  } catch (e) {
    return { kind: 'NetworkError', message: String(e), exitCode: 3 };
  }
  if (res.status === 401) return { kind: 'AuthError', message: 'Invalid API key', exitCode: 4 };
  if (res.status === 402) return { kind: 'TierRequired', message: 'Feature requires paid tier', exitCode: 5 };
  if (res.status === 429) return { kind: 'RateLimited', message: 'Rate limit exceeded', exitCode: 6 };
  if (res.status === 404) return { kind: 'NotFound', message: `Project ${req.projectId} not found`, exitCode: 7 };
  if (!res.ok) return { kind: 'ValidationError', message: `HTTP ${res.status}`, exitCode: 8 };
  return (await res.json()) as CloudRuntimeContext;
}

export function isCloudError(v: CloudRuntimeContext | CloudError): v is CloudError {
  return (v as CloudError).kind !== undefined && (v as CloudError).exitCode !== undefined;
}
