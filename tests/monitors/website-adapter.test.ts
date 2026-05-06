import { describe, expect, it } from 'vitest';
import { websiteAdapter } from '../../src/monitors/website-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('websiteAdapter', () => {
  it('accepts http/https URL and lowercases host', async () => {
    expect(await websiteAdapter.validateTarget(' https://Example.COM/Path?q=1 ')).toEqual({
      target: 'https://Example.COM/Path?q=1',
      normalizedTarget: 'https://example.com/Path?q=1',
      configJson: {}
    });
  });

  it('rejects non-http schemes', async () => {
    await expect(websiteAdapter.validateTarget('ftp://example.com')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed URL', async () => {
    await expect(websiteAdapter.validateTarget('not a url')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source with worker-not-available marker', () => {
    expect(
      websiteAdapter.describe({
        type: 'website',
        target: 'https://example.com',
        normalizedTarget: 'https://example.com',
        configJson: {}
      })
    ).toBe('🌐 website:https://example.com ⚠️ worker 暂未上线');
  });
});
