import { describe, expect, it } from 'vitest';
import { contractAdapter } from '../../src/monitors/contract-adapter.js';
import { ValidationError } from '../../src/monitors/adapter.js';

describe('contractAdapter', () => {
  it('accepts eth address with checksum', async () => {
    const result = await contractAdapter.validateTarget('eth 0xAbCdEf0123456789abcdef0123456789abcdef01');
    expect(result.normalizedTarget).toBe('eth:0xabcdef0123456789abcdef0123456789abcdef01');
    expect(result.configJson).toEqual({ chain: 'eth', address: '0xabcdef0123456789abcdef0123456789abcdef01' });
  });

  it('accepts bsc address', async () => {
    const result = await contractAdapter.validateTarget('bsc 0x0000000000000000000000000000000000000001');
    expect(result.configJson).toMatchObject({ chain: 'bsc' });
  });

  it('accepts sol address (base58)', async () => {
    const result = await contractAdapter.validateTarget('sol So11111111111111111111111111111111111111112');
    expect(result.configJson).toMatchObject({ chain: 'sol' });
  });

  it('rejects unknown chain', async () => {
    await expect(contractAdapter.validateTarget('btc 0xabc')).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects malformed eth address', async () => {
    await expect(contractAdapter.validateTarget('eth 0x123')).rejects.toBeInstanceOf(ValidationError);
  });

  it('describes a stored source with worker-not-available marker', () => {
    expect(
      contractAdapter.describe({
        type: 'contract',
        target: 'eth 0xabcdef0123456789abcdef0123456789abcdef01',
        normalizedTarget: 'eth:0xabcdef0123456789abcdef0123456789abcdef01',
        configJson: { chain: 'eth', address: '0xabcdef0123456789abcdef0123456789abcdef01' }
      })
    ).toBe('📜 contract:eth:0xabcdef0123456789abcdef0123456789abcdef01 ⚠️ worker 暂未上线');
  });
});
