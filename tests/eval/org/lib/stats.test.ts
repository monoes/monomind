// Interval helpers for the org eval (spec section 10): five passing runs do
// not establish a high reliability floor, and a point estimate from a handful
// of runs is reported with its interval, or not at all.
import { describe, expect, it } from 'vitest';
import { meanInterval, pairedDifference, wilsonInterval } from './stats.js';

describe('wilsonInterval', () => {
  it('five of five passing still leaves a wide interval', () => {
    const [lo, hi] = wilsonInterval(5, 5);
    expect(lo).toBeCloseTo(0.566, 2);
    expect(hi).toBe(1);
  });
  it('matches the textbook value for 50 of 100', () => {
    const [lo, hi] = wilsonInterval(50, 100);
    expect(lo).toBeCloseTo(0.404, 2);
    expect(hi).toBeCloseTo(0.596, 2);
  });
  it('is uninformative with no runs, and 0 of n has a floor of 0', () => {
    expect(wilsonInterval(0, 0)).toEqual([0, 1]);
    expect(wilsonInterval(0, 10)[0]).toBe(0);
  });
  it('rejects more successes than runs', () => {
    expect(() => wilsonInterval(6, 5)).toThrow();
  });
});

describe('meanInterval', () => {
  it('returns the mean and a seeded, reproducible bootstrap interval', () => {
    const xs = [10, 12, 9, 11, 13, 10, 12, 11];
    const a = meanInterval(xs, { seed: 7 });
    const b = meanInterval(xs, { seed: 7 });
    expect(a).toEqual(b);
    expect(a.mean).toBeCloseTo(11, 5);
    expect(a.lo!).toBeLessThan(a.mean);
    expect(a.hi!).toBeGreaterThan(a.mean);
    expect(a.n).toBe(8);
  });
  it('widens with more spread and narrows with more runs', () => {
    const tight = meanInterval([10, 10.1, 9.9, 10, 10.1, 9.9], { seed: 1 });
    const loose = meanInterval([5, 15, 2, 18, 9, 11], { seed: 1 });
    expect(loose.hi! - loose.lo!).toBeGreaterThan(tight.hi! - tight.lo!);
  });
  it('gives no interval for fewer than two runs', () => {
    expect(meanInterval([3])).toEqual({ mean: 3, lo: null, hi: null, n: 1 });
    expect(meanInterval([])).toEqual({ mean: null, lo: null, hi: null, n: 0 });
  });
});

describe('pairedDifference', () => {
  it('is the mean of per-pair differences, a - b, with its interval', () => {
    const d = pairedDifference([5, 6, 7, 8], [3, 3, 4, 4], { seed: 3 });
    expect(d.mean).toBeCloseTo(3, 5);
    expect(d.lo!).toBeGreaterThan(0); // a is consistently higher
    expect(d.n).toBe(4);
  });
  it('an interval spanning zero means no distinguishable difference', () => {
    const d = pairedDifference([5, 3, 6, 2, 5, 4], [4, 4, 4, 4, 4, 4], { seed: 3 });
    expect(d.lo!).toBeLessThan(0);
    expect(d.hi!).toBeGreaterThan(0);
  });
  it('requires equal-length series', () => {
    expect(() => pairedDifference([1, 2], [1])).toThrow();
  });
});
