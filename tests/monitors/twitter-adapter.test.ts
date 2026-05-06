import { describe, expect, it } from 'vitest';
import { twitterAdapter } from '../../src/monitors/twitter-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('twitterAdapter', () => {
  it('strips leading @ and trims whitespace', async () => {
    expect(await twitterAdapter.validateTarget('  @ElonMusk  ')).toEqual({
      target: 'ElonMusk',
      normalizedTarget: 'elonmusk',
      configJson: {}
    });
  });

  it('rejects empty input', async () => {
    await expect(twitterAdapter.validateTarget('   ')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects illegal handle characters', async () => {
    await expect(twitterAdapter.validateTarget('elon-musk')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source', () => {
    expect(
      twitterAdapter.describe({
        type: 'twitter',
        target: '@elonmusk',
        normalizedTarget: 'elonmusk',
        configJson: {}
      })
    ).toBe('🐦 twitter:elonmusk');
  });
});
