import { describe, expect, it, vi } from 'vitest';
import { createWatchSynchronizer } from '../../src/bot/main.js';

describe('createWatchSynchronizer', () => {
  it('delegates watch registration to the 6551 add/delete helpers with the configured token', async () => {
    const addWatchAccount = vi.fn().mockResolvedValue({ ok: true, alreadyExists: false });
    const deleteWatchAccount = vi.fn().mockResolvedValue({ ok: true, alreadyMissing: false });
    const synchronizer = createWatchSynchronizer('token-123', {
      addWatchAccount,
      deleteWatchAccount
    });

    await expect(synchronizer.registerWatch('elonmusk')).resolves.toEqual({ ok: true, alreadyExists: false });
    await expect(synchronizer.unregisterWatch('vitalikbuterin')).resolves.toEqual({
      ok: true,
      alreadyMissing: false
    });

    expect(addWatchAccount).toHaveBeenCalledWith({ token: 'token-123', account: 'elonmusk' });
    expect(deleteWatchAccount).toHaveBeenCalledWith({ token: 'token-123', account: 'vitalikbuterin' });
  });
});
