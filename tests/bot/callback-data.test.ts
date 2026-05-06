import { describe, expect, it } from 'vitest';
import { decodeCallback, encodeCallback } from '../../src/bot/callback-data.js';

describe('callback data codec', () => {
  it('encodes and decodes simple action', () => {
    const data = encodeCallback({ action: 'menu' });
    expect(decodeCallback(data)).toEqual({ action: 'menu' });
  });

  it('encodes and decodes action with numeric id', () => {
    const data = encodeCallback({ action: 'src.toggle', id: 42 });
    expect(decodeCallback(data)).toEqual({ action: 'src.toggle', id: 42 });
  });

  it('encodes and decodes action with arg', () => {
    const data = encodeCallback({ action: 'add.type', arg: 'twitter' });
    expect(decodeCallback(data)).toEqual({ action: 'add.type', arg: 'twitter' });
  });

  it('returns null for malformed payloads', () => {
    expect(decodeCallback('garbage')).toBeNull();
    expect(decodeCallback('')).toBeNull();
  });

  it('keeps payload <= 64 bytes (Telegram limit)', () => {
    const data = encodeCallback({ action: 'src.subscribe.toggle', id: 999_999_999, arg: 'd:42' });
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
  });
});
