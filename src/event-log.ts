import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { NdjsonEntry } from './events.js';

export const EVENT_LOG_FILENAME = 'twitter-events.ndjson';

export async function appendEventLog(logDir: string, entry: NdjsonEntry): Promise<void> {
  await mkdir(logDir, { recursive: true });
  await appendFile(join(logDir, EVENT_LOG_FILENAME), `${JSON.stringify(entry)}\n`, 'utf8');
}
