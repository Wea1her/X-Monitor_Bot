import { describe, expect, it } from 'vitest';
import { getAdapter, listAdapterTypes } from '../../src/monitors/registry.js';

describe('monitor registry', () => {
  it('returns the adapter for a known type', () => {
    expect(getAdapter('twitter').type).toBe('twitter');
    expect(getAdapter('website').type).toBe('website');
    expect(getAdapter('contract').type).toBe('contract');
  });

  it('throws for unknown type', () => {
    expect(() => getAdapter('btc')).toThrow('Unknown monitor type: btc');
  });

  it('lists supported types', () => {
    expect(listAdapterTypes()).toEqual(['twitter', 'website', 'contract']);
  });
});
