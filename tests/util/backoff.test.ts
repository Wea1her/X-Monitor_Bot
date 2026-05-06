import { describe, expect, it, vi } from 'vitest';
import { getBackoffDelayMs } from '../../src/util/backoff.js';

describe('getBackoffDelayMs', () => {
  it('returns base delay times jitter at attempt 0', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getBackoffDelayMs(0)).toBe(800);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(getBackoffDelayMs(0)).toBeCloseTo(1200, -1);
  });

  it('doubles each attempt with jitter window', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(getBackoffDelayMs(1)).toBe(2000);
    expect(getBackoffDelayMs(2)).toBe(4000);
    expect(getBackoffDelayMs(3)).toBe(8000);
  });

  it('caps base delay at 30000ms before jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // jitter -> 0.8x
    expect(getBackoffDelayMs(20)).toBe(24_000);
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    expect(getBackoffDelayMs(20)).toBeCloseTo(36_000, -2);
  });
});
