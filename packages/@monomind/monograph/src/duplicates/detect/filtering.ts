import type { RawGroup } from './extraction.js';

export interface Interval {
  start: number;
  end: number;
}

export class IntervalIndex {
  private intervals: Array<{ start: number; end: number }> = [];

  insert(interval: Interval): void {
    const { start, end } = interval;
    const lo = this.partitionByEnd(start);
    const hi = this.partitionByStart(end);

    if (lo === hi) {
      this.intervals.splice(lo, 0, { start, end });
    } else {
      const mergedStart = Math.min(this.intervals[lo].start, start);
      const mergedEnd = Math.max(this.intervals[hi - 1].end, end);
      this.intervals.splice(lo, hi - lo, { start: mergedStart, end: mergedEnd });
    }
  }

  contains(interval: Interval): boolean {
    const { start, end } = interval;
    const idx = this.partitionByStart(start + 1) - 1;
    if (idx < 0) return false;
    const iv = this.intervals[idx];
    return iv.start <= start && end <= iv.end;
  }

  overlaps(interval: Interval): boolean {
    const { start, end } = interval;
    const lo = this.partitionByEnd(start);
    if (lo >= this.intervals.length) return false;
    return this.intervals[lo].start < end;
  }

  private partitionByEnd(val: number): number {
    let lo = 0;
    let hi = this.intervals.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.intervals[mid].end < val) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private partitionByStart(val: number): number {
    let lo = 0;
    let hi = this.intervals.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.intervals[mid].start <= val) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}

export function filterCloneGroups(
  groups: RawGroup[],
  fileOffsets: number[],
  fileOf: number[],
  minLines: number,
  lineCount: (fileId: number, offset: number, length: number) => number,
): RawGroup[] {
  const sorted = [...groups].sort((a, b) => b.lcpLength - a.lcpLength);

  const numFiles = fileOffsets.length;
  const covered = new Map<number, IntervalIndex>();

  const getIndex = (fid: number): IntervalIndex => {
    let idx = covered.get(fid);
    if (!idx) {
      idx = new IntervalIndex();
      covered.set(fid, idx);
    }
    return idx;
  };

  const result: RawGroup[] = [];

  for (const group of sorted) {
    const len = group.lcpLength;

    const allCovered = group.instances.every((inst) => {
      const idx = covered.get(inst.fileId);
      if (!idx) return false;
      return idx.contains({ start: inst.offset, end: inst.offset + len });
    });

    if (allCovered) continue;

    const lines = Math.max(
      ...group.instances.map((inst) => lineCount(inst.fileId, inst.offset, len)),
    );
    if (lines < minLines) continue;

    for (const inst of group.instances) {
      getIndex(inst.fileId).insert({ start: inst.offset, end: inst.offset + len });
    }

    result.push(group);
  }

  void numFiles;
  void fileOf;
  return result;
}
