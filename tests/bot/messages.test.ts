import type { MonitorSource } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { describeSourceLine } from '../../src/bot/messages.js';

function source(overrides = {}): MonitorSource {
  return {
    id: 7,
    type: 'twitter',
    target: 'ElonMusk',
    normalizedTarget: 'elonmusk',
    configJson: {},
    enabled: true,
    remoteWatchStatus: 'synced',
    remoteWatchError: null,
    remoteWatchSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as MonitorSource;
}

describe('describeSourceLine', () => {
  it('shows 6551 sync errors on source lines', () => {
    const line = describeSourceLine(
      source({
        remoteWatchStatus: 'error',
        remoteWatchError: 'bad token'
      })
    );

    expect(line).toContain('6551同步失败：bad token');
  });
});
