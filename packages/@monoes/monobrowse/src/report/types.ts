/**
 * Shared shapes for `monobrowse report` — the one-command page test rig.
 *
 * The pipeline is collect (drive the browser) -> analyze (a11y rules +
 * budget evaluation) -> render (self-contained HTML). Only `collect` talks
 * to Chrome; everything downstream is a pure function over these types,
 * which is what makes the analyzer and the renderer unit-testable without
 * launching a browser.
 */

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

export type A11yRuleId =
  | 'unlabelled-control'
  | 'image-missing-alt'
  | 'form-field-no-label'
  | 'heading-order-jump'
  | 'negative-tabindex';

export type A11yImpact = 'error' | 'warning';

export interface A11yFinding {
  rule: A11yRuleId;
  impact: A11yImpact;
  /** ARIA role as the AX tree reports it, lowercased. */
  role: string;
  /** Accessible name, or null when the finding IS the missing name. */
  name: string | null;
  /** CSS selector when we could resolve one, else `ax-node:<id>`. */
  locator: string;
  detail: string;
}

/**
 * The subset of CDP's `Accessibility.AXNode` these rules read. Declared here
 * rather than imported because snapshot.ts keeps its own copy private, and
 * because tests feed in hand-written fixture trees.
 *
 * Note `nodeId` is a string on the wire (`AXNodeId`); number is accepted so
 * fixtures can stay terse.
 */
export interface AxNode {
  nodeId: string | number;
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: Array<{ name: string; value?: { value?: unknown } }>;
  backendDOMNodeId?: number;
  parentId?: string | number;
  childIds?: Array<string | number>;
}

/**
 * An element the DOM says has a negative tabindex. The AX tree cannot
 * report tabindex at all, so this comes from a separate DOM sweep.
 */
export interface FocusCandidate {
  tag: string;
  role: string;
  name: string | null;
  tabindex: number;
  locator: string;
}

// ---------------------------------------------------------------------------
// Collected page data
// ---------------------------------------------------------------------------

export interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
  timestamp: number;
}

export interface PageErrorEntry {
  text: string;
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  timestamp: number;
}

export interface RequestEntry {
  url: string;
  method: string;
  /**
   * Wall-clock ms the request started, when the CDP monotonic clock could be
   * aligned to Date.now(). Absent otherwise — the evidence timeline (RIG-11)
   * is the only consumer and it degrades to omitting the request.
   */
  startedAtMs?: number;
  status?: number;
  mimeType?: string;
  durationMs?: number;
  encodedSize?: number;
  /** True for a 4xx/5xx response or a request that never got one. */
  failed: boolean;
  /** CDP `Network.loadingFailed` errorText / blockedReason, when we saw one. */
  errorText?: string;
}

export interface VitalsData {
  lcp?: number;
  fcp?: number;
  cls?: number;
  ttfb?: number;
  inp?: number;
  domInteractive?: number;
  domContentLoaded?: number;
  loadTime?: number;
  resources?: number;
}

export interface Screenshot {
  /** Device name, or 'page' for the default viewport shot. */
  label: string;
  width: number;
  height: number;
  /** `data:image/png;base64,...` — inlined so the HTML stays self-contained. */
  dataUrl: string;
  /** Where captureScreenshot also dropped the PNG, for callers that want it. */
  path?: string;
}

export interface CaptureData {
  /** URL as requested on the command line. */
  url: string;
  /** URL after redirects / client-side navigation. */
  finalUrl: string;
  title: string;
  capturedAt: string;
  durationMs: number;
  console: ConsoleEntry[];
  pageErrors: PageErrorEntry[];
  requests: RequestEntry[];
  vitals: VitalsData;
  a11y: A11yFinding[];
  screenshots: Screenshot[];
  /**
   * Flat AX-tree signature used for the structural diff. Optional because a
   * page whose AX tree we could not read still produces a valid report.
   */
  structure?: StructureNode[];
  /** Screencast frames + timeline, present only when evidence was recorded. */
  evidence?: Evidence;
  /** Raw recorder output, consumed by runReport and never serialized. */
  recording?: Recording;
  /** Anything that degraded — a timeout, a collector that came back empty. */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Budgets and verdict
// ---------------------------------------------------------------------------

/** `null` means "do not enforce this one". */
export interface Budget {
  maxConsoleErrors: number | null;
  maxPageErrors: number | null;
  maxFailedRequests: number | null;
  maxA11yErrors: number | null;
  lcpMs: number | null;
  clsScore: number | null;
  inpMs: number | null;
  fcpMs: number | null;
  ttfbMs: number | null;
}

export interface BudgetFailure {
  /** The budget key that was breached, e.g. `lcpMs`. */
  budget: keyof Budget;
  /** Human-readable threshold, e.g. `<= 2500ms`. */
  expected: string;
  /** Human-readable measurement, e.g. `3120ms`. */
  actual: string;
  /** Concrete evidence — which errors, which requests. */
  detail?: string;
}

export type VerdictValue = 'pass' | 'fail';

export interface Report extends CaptureData {
  budget: Budget;
  verdict: VerdictValue;
  failures: BudgetFailure[];
  /** Budgets we could not evaluate (e.g. the page reported no LCP). */
  unmeasured: string[];
  counts: {
    consoleErrors: number;
    consoleWarnings: number;
    pageErrors: number;
    requests: number;
    failedRequests: number;
    a11yErrors: number;
    a11yWarnings: number;
  };
  /** This run against the previous N for the same URL (RIG-13). */
  trend?: TrendReport;
  /** This run against the immediately previous one (RIG-10). */
  diff?: RunDiff;
}

// ---------------------------------------------------------------------------
// Structural signature and run-to-run diff (RIG-10)
// ---------------------------------------------------------------------------

/** One AX-tree element, addressed by a path of `role[n]` segments. */
export interface StructureNode {
  path: string;
  role: string;
  name: string | null;
  depth: number;
}

export interface StructureDiff {
  gained: StructureNode[];
  lost: StructureNode[];
  /** Same slot, same role, different accessible name. */
  renamed: Array<{ path: string; role: string; from: string | null; to: string | null }>;
  /** Same role and name, different path — reordered, not added or removed. */
  moved: Array<{ role: string; name: string | null; from: string; to: string }>;
  unchanged: number;
  /** gained + lost + renamed. `moved` is excluded: moving is rarely a defect. */
  changed: number;
}

export interface ImageSize {
  width: number;
  height: number;
}

export interface PixelDiff {
  /** False when a screenshot could not be decoded; see `note`. */
  comparable: boolean;
  changedPixels: number;
  totalPixels: number;
  changedPercent: number;
  previousSize: ImageSize | null;
  currentSize: ImageSize | null;
  sizeChanged: boolean;
  /** Highlight image, `data:image/png;base64,...`. Absent when nothing changed. */
  diffDataUrl?: string;
  /** Integer downscale factor applied to the highlight image, when > 1. */
  scale?: number;
  note?: string;
}

export interface RunDiff {
  previousRunId: string;
  previousCapturedAt: string;
  structure?: StructureDiff;
  pixels?: PixelDiff;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Trends (RIG-13)
// ---------------------------------------------------------------------------

export type TrendDirection = 'improved' | 'regressed' | 'flat' | 'new';

export interface TrendPoint {
  capturedAt: string;
  value: number | null;
}

export interface TrendSeries {
  /** Metric key, e.g. `lcp` or `consoleErrors`. */
  key: string;
  label: string;
  unit: 'ms' | 'score' | 'count';
  /** Oldest to newest; the last point is this run. */
  points: TrendPoint[];
  current: number | null;
  previous: number | null;
  oldest: number | null;
  deltaFromPrevious: number | null;
  deltaFromOldest: number | null;
  direction: TrendDirection;
  /** Set when drift across the whole window is big enough to name out loud. */
  creep?: string;
}

export interface TrendReport {
  /** How many prior runs this run was compared against. */
  runs: number;
  windowFrom: string | null;
  series: TrendSeries[];
  verdictHistory: Array<{ capturedAt: string; verdict: VerdictValue }>;
  /** The sentences worth reading first, e.g. slow LCP decay. */
  headlines: string[];
}

// ---------------------------------------------------------------------------
// Recorded evidence (RIG-11)
// ---------------------------------------------------------------------------

/** One screencast frame as the recorder buffers it, before selection. */
export interface RawFrame {
  /** Milliseconds since the run started. */
  offsetMs: number;
  /** Base64 JPEG, as CDP hands it over. */
  data: string;
  bytes: number;
}

/**
 * The recorder's raw output, carried on CaptureData so `runReport` can turn
 * it into an Evidence block once the verdict is known. Stripped from the JSON
 * sibling — it is working material, not part of the report.
 */
export interface Recording {
  /** `Date.now()` at the start of the run: the zero of every frame offset. */
  startedAtMs: number;
  frames: RawFrame[];
  /** Frames already dropped to keep the in-memory buffer bounded. */
  droppedFrames: number;
  /** True when the caller asked for a recording regardless of the verdict. */
  requested: boolean;
}

export interface EvidenceFrame {
  /** Milliseconds since the run started. */
  offsetMs: number;
  /** `data:image/jpeg;base64,...` */
  dataUrl: string;
  bytes: number;
}

export type TimelineKind = 'frame' | 'console' | 'pageerror' | 'request' | 'marker';

export interface TimelineEntry {
  offsetMs: number;
  kind: TimelineKind;
  label: string;
  detail?: string;
  severity: 'info' | 'warning' | 'error';
  /** Index into `Evidence.frames` for a `frame` entry. */
  frameIndex?: number;
}

export interface Evidence {
  reason: 'budget-failure' | 'requested';
  /** Offset the timeline is centred on — the first failure we could locate. */
  focusOffsetMs: number | null;
  frames: EvidenceFrame[];
  timeline: TimelineEntry[];
  /** Frames captured but dropped to stay inside the count/byte budget. */
  droppedFrames: number;
  totalBytes: number;
  notes: string[];
}
