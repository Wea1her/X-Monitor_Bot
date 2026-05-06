import { describe, expect, it, vi } from 'vitest';
import {
  buildDedupeKey,
  buildEventText,
  handleWorkerPayload,
  type HandleWorkerDeps
} from '../../src/workers/twitter-worker.js';

const evt = {
  jsonrpc: '2.0',
  method: 'twitter.event',
  params: {
    twAccount: 'elonmusk',
    twUserName: 'Elon',
    profileUrl: 'https://twitter.com/elonmusk',
    eventType: 'NEW_TWEET',
    createdAt: '2026-05-05T01:02:03Z',
    content: { id: 'tweet-1', text: 'hello world' }
  }
};

describe('buildDedupeKey', () => {
  it('uses content.id when present', () => {
    expect(buildDedupeKey(evt)).toBe('tw:elonmusk:NEW_TWEET:tweet-1');
  });

  it('falls back to sha1 when content has no id', () => {
    const noId = { ...evt, params: { ...evt.params, content: { text: 'a' } } };
    expect(buildDedupeKey(noId)).toMatch(/^tw:elonmusk:NEW_TWEET:[0-9a-f]{40}$/);
  });
});

describe('buildEventText', () => {
  it('formats a Telegram-friendly message', () => {
    expect(buildEventText(evt)).toContain('NEW_TWEET');
    expect(buildEventText(evt)).toContain('@elonmusk');
    expect(buildEventText(evt)).toContain('hello world');
  });
});

describe('handleWorkerPayload', () => {
  function makeDeps(over: Partial<HandleWorkerDeps> = {}): HandleWorkerDeps {
    return {
      findSourceIdByAccount: vi.fn().mockResolvedValue(10),
      recordEvent: vi.fn().mockResolvedValue({ event: { id: 50 }, deduped: false }),
      fanOut: vi.fn().mockResolvedValue(undefined),
      info: vi.fn(),
      warn: vi.fn(),
      ...over
    };
  }

  it('records event and dispatches when not deduped', async () => {
    const deps = makeDeps();
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.recordEvent).toHaveBeenCalledTimes(1);
    expect(deps.fanOut).toHaveBeenCalledWith({
      eventLogId: 50,
      sourceId: 10,
      text: expect.stringContaining('NEW_TWEET')
    });
  });

  it('skips dispatch when event was deduped', async () => {
    const deps = makeDeps({
      recordEvent: vi.fn().mockResolvedValue({ event: null, deduped: true })
    });
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.fanOut).not.toHaveBeenCalled();
  });

  it('skips dispatch when no matching source', async () => {
    const deps = makeDeps({ findSourceIdByAccount: vi.fn().mockResolvedValue(null) });
    await handleWorkerPayload(JSON.stringify(evt), deps);
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(deps.fanOut).not.toHaveBeenCalled();
  });

  it('logs and ignores invalid JSON', async () => {
    const deps = makeDeps();
    await handleWorkerPayload('not-json', deps);
    expect(deps.warn).toHaveBeenCalledWith('Invalid WSS message JSON ignored');
  });

  it('ignores non-event messages', async () => {
    const deps = makeDeps();
    await handleWorkerPayload(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { success: true } }), deps);
    expect(deps.recordEvent).not.toHaveBeenCalled();
    expect(deps.fanOut).not.toHaveBeenCalled();
  });
});
