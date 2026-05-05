import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appendEventLog } from '../src/event-log.js';

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe('appendEventLog', () => {
  it('creates the log directory and appends one JSON object per line', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'x-monitor-'));
    const logDir = join(tempDir, 'nested-logs');

    await appendEventLog(logDir, {
      receivedAt: '2026-04-27T10:00:00.000Z',
      message: { method: 'twitter.event', params: { eventType: 'NEW_TWEET' } }
    });
    await appendEventLog(logDir, {
      receivedAt: '2026-04-27T10:01:00.000Z',
      message: { method: 'twitter.event', params: { eventType: 'NEW_FOLLOWER' } }
    });

    const content = await readFile(join(logDir, 'twitter-events.ndjson'), 'utf8');
    const lines = content.trim().split('\n').map((line) => JSON.parse(line));

    expect(lines).toEqual([
      {
        receivedAt: '2026-04-27T10:00:00.000Z',
        message: { method: 'twitter.event', params: { eventType: 'NEW_TWEET' } }
      },
      {
        receivedAt: '2026-04-27T10:01:00.000Z',
        message: { method: 'twitter.event', params: { eventType: 'NEW_FOLLOWER' } }
      }
    ]);
  });
});
