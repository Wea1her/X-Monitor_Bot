import { describe, expect, it } from 'vitest';
import { formatStartupMessage } from '../src/index.js';

describe('formatStartupMessage', () => {
  it('formats watched accounts for CLI startup logs', () => {
    expect(formatStartupMessage(['elonmusk', 'VitalikButerin'])).toBe(
      'Starting OpenTwitter WSS probe for @elonmusk, @VitalikButerin'
    );
  });
});
