// Minimal bun:test compatibility shim over node:test + node:assert.
// The ported monodesign suite ran some files under `bun test`; monodesign runs
// everything under `node --test`, so those files import this shim instead.
import { describe, it, beforeEach, afterEach, before, after } from 'node:test';
import assert from 'node:assert/strict';

export { describe, beforeEach, afterEach, before, after };
export const test = it;
export { it };

const OBJECT_CONTAINING = Symbol('objectContaining');

function isDeepEqual(a, b) {
  // Asymmetric matcher support: expect.objectContaining(subset)
  if (b && typeof b === 'object' && b[OBJECT_CONTAINING]) {
    const subset = b.subset;
    if (a == null || typeof a !== 'object') return false;
    return Object.entries(subset).every(([k, v]) => isDeepEqual(a[k], v));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => isDeepEqual(v, b[i]));
  }
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

class Expectation {
  constructor(actual, negated = false) {
    this.actual = actual;
    this.negated = negated;
  }

  get not() {
    return new Expectation(this.actual, !this.negated);
  }

  #check(pass, message) {
    if (this.negated ? pass : !pass) {
      throw new assert.AssertionError({
        message: `${this.negated ? 'not.' : ''}${message}`,
        actual: this.actual,
        stackStartFn: this.#check,
      });
    }
  }

  toBe(expected) {
    this.#check(Object.is(this.actual, expected), `expected ${format(this.actual)} toBe ${format(expected)}`);
  }

  toEqual(expected) {
    this.#check(isDeepEqual(this.actual, expected), `expected ${format(this.actual)} toEqual ${format(expected)}`);
  }

  toContain(expected) {
    let pass = false;
    if (typeof this.actual === 'string') pass = this.actual.includes(expected);
    else if (Array.isArray(this.actual)) pass = this.actual.some((v) => Object.is(v, expected) || isDeepEqual(v, expected));
    else if (this.actual && typeof this.actual[Symbol.iterator] === 'function') pass = [...this.actual].some((v) => Object.is(v, expected) || isDeepEqual(v, expected));
    this.#check(pass, `expected ${format(this.actual)} toContain ${format(expected)}`);
  }

  toMatch(expected) {
    const re = expected instanceof RegExp ? expected : new RegExp(expected);
    this.#check(re.test(String(this.actual)), `expected ${format(this.actual)} toMatch ${re}`);
  }

  toHaveLength(expected) {
    this.#check(this.actual != null && this.actual.length === expected, `expected length ${this.actual?.length} toBe ${expected}`);
  }

  toHaveProperty(keyPath, ...value) {
    const parts = String(keyPath).split('.');
    let cur = this.actual;
    let present = true;
    for (const part of parts) {
      if (cur != null && (typeof cur === 'object' || typeof cur === 'function') && part in cur) {
        cur = cur[part];
      } else {
        present = false;
        break;
      }
    }
    if (present && value.length > 0) present = isDeepEqual(cur, value[0]);
    this.#check(present, `expected ${format(this.actual)} toHaveProperty ${keyPath}`);
  }

  toBeGreaterThan(expected) {
    this.#check(this.actual > expected, `expected ${format(this.actual)} toBeGreaterThan ${format(expected)}`);
  }

  toBeGreaterThanOrEqual(expected) {
    this.#check(this.actual >= expected, `expected ${format(this.actual)} toBeGreaterThanOrEqual ${format(expected)}`);
  }

  toBeLessThan(expected) {
    this.#check(this.actual < expected, `expected ${format(this.actual)} toBeLessThan ${format(expected)}`);
  }

  toBeLessThanOrEqual(expected) {
    this.#check(this.actual <= expected, `expected ${format(this.actual)} toBeLessThanOrEqual ${format(expected)}`);
  }

  toBeTruthy() {
    this.#check(Boolean(this.actual), `expected ${format(this.actual)} toBeTruthy`);
  }

  toBeFalsy() {
    this.#check(!this.actual, `expected ${format(this.actual)} toBeFalsy`);
  }

  toBeNull() {
    this.#check(this.actual === null, `expected ${format(this.actual)} toBeNull`);
  }

  toBeUndefined() {
    this.#check(this.actual === undefined, `expected ${format(this.actual)} toBeUndefined`);
  }

  toBeDefined() {
    this.#check(this.actual !== undefined, `expected ${format(this.actual)} toBeDefined`);
  }

  toBeArray() {
    this.#check(Array.isArray(this.actual), `expected ${format(this.actual)} toBeArray`);
  }

  toBeTypeOf(expected) {
    this.#check(typeof this.actual === expected, `expected typeof ${format(this.actual)} toBe ${expected}`);
  }

  toBeInstanceOf(expected) {
    this.#check(this.actual instanceof expected, `expected ${format(this.actual)} toBeInstanceOf ${expected?.name}`);
  }

  toThrow(expected) {
    let threw = false;
    let error;
    try {
      this.actual();
    } catch (err) {
      threw = true;
      error = err;
    }
    let pass = threw;
    if (threw && expected !== undefined) {
      const msg = String(error?.message ?? error);
      if (expected instanceof RegExp) pass = expected.test(msg);
      else if (typeof expected === 'string') pass = msg.includes(expected);
    }
    this.#check(pass, 'expected function toThrow');
  }
}

function format(value) {
  try {
    if (typeof value === 'string') return JSON.stringify(value.length > 120 ? value.slice(0, 117) + '...' : value);
    return String(JSON.stringify(value))?.slice(0, 120) ?? String(value);
  } catch {
    return String(value);
  }
}

export function expect(actual) {
  return new Expectation(actual);
}

expect.objectContaining = (subset) => ({ [OBJECT_CONTAINING]: true, subset });
