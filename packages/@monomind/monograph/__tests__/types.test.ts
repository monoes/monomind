import { CONFIDENCE_SCORE } from '../src/types.js';

describe('CONFIDENCE_SCORE', () => {
  it('assigns 1.0 to EXTRACTED', () => {
    expect(CONFIDENCE_SCORE.EXTRACTED).toBe(1.0);
  });
  it('assigns 0.5 to INFERRED', () => {
    expect(CONFIDENCE_SCORE.INFERRED).toBe(0.5);
  });
  it('assigns 0.2 to AMBIGUOUS', () => {
    expect(CONFIDENCE_SCORE.AMBIGUOUS).toBe(0.2);
  });
});
