import { describe, expect, it } from 'vitest';
import {
  addDecimal,
  divideDecimal,
  multiplyDecimal,
} from '../../worker/src/adapters/db/portfolio-repository';

/**
 * Money never round-trips through a JS number (FR-051).
 *
 * These are the cases that make the rule concrete: each one produces a
 * visibly wrong answer with floating point, and a cost basis is not where
 * anyone wants to discover that.
 */
describe('exact decimal arithmetic', () => {
  it('adds without floating-point drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as a float.
    expect(addDecimal('0.1', '0.2')).toBe('0.3');
    expect(addDecimal('1.005', '2.995')).toBe('4');
    expect(addDecimal('0', '0')).toBe('0');
  });

  it('adds across differing scales', () => {
    expect(addDecimal('1', '0.00000001')).toBe('1.00000001');
    expect(addDecimal('100.5', '0.25')).toBe('100.75');
  });

  it('handles negatives', () => {
    expect(addDecimal('-1.5', '0.5')).toBe('-1');
    expect(addDecimal('5', '-7.25')).toBe('-2.25');
  });

  it('multiplies exactly', () => {
    // 3 * 0.1 === 0.30000000000000004 as a float.
    expect(multiplyDecimal('3', '0.1')).toBe('0.3');
    expect(multiplyDecimal('25', '480.15')).toBe('12003.75');
    expect(multiplyDecimal('0', '480.15')).toBe('0');
  });

  it('divides to a fixed scale, truncating rather than rounding up', () => {
    expect(divideDecimal('12003.75', '25', 8)).toBe('480.15');
    expect(divideDecimal('1', '3', 8)).toBe('0.33333333');
  });

  it('returns zero rather than throwing on division by zero', () => {
    // An item with no quantity must render, not crash the portfolio view.
    expect(divideDecimal('100', '0')).toBe('0');
  });

  it('computes a weighted average entry price exactly', () => {
    // Two lots: 10 @ 0.1 and 20 @ 0.2 -> cost 5, quantity 30.
    const cost = addDecimal(multiplyDecimal('10', '0.1'), multiplyDecimal('20', '0.2'));
    expect(cost).toBe('5');
    expect(divideDecimal(cost, '30', 8)).toBe('0.16666666');
  });
});
