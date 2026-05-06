import type { MonitorAdapter } from './adapter.js';
import { twitterAdapter } from './twitter-adapter.js';
import { websiteAdapter } from './website-adapter.js';
import { contractAdapter } from './contract-adapter.js';

const ADAPTERS: Record<string, MonitorAdapter> = {
  twitter: twitterAdapter,
  website: websiteAdapter,
  contract: contractAdapter
};

export function getAdapter(type: string): MonitorAdapter {
  const adapter = ADAPTERS[type];
  if (!adapter) {
    throw new Error(`Unknown monitor type: ${type}`);
  }
  return adapter;
}

export function listAdapterTypes(): string[] {
  return ['twitter', 'website', 'contract'];
}
