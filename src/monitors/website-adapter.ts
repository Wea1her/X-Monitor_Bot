import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

export const websiteAdapter: MonitorAdapter = {
  type: 'website',
  async validateTarget(input) {
    const trimmed = input.trim();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ValidationError('网站地址不是合法 URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new ValidationError('网站监控仅支持 http / https');
    }
    const normalized = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}${url.search}${url.hash}`;
    return {
      target: trimmed,
      normalizedTarget: normalized,
      configJson: {}
    };
  },
  describe(source) {
    return `🌐 website:${source.normalizedTarget} ⚠️ worker 暂未上线`;
  }
};
