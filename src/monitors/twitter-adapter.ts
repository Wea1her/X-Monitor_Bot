import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export const twitterAdapter: MonitorAdapter = {
  type: 'twitter',
  async validateTarget(input) {
    const stripped = input.trim().replace(/^@+/, '').trim();
    if (stripped.length === 0) {
      throw new ValidationError('Twitter 用户名不能为空');
    }
    if (!HANDLE_RE.test(stripped)) {
      throw new ValidationError('Twitter 用户名仅允许字母、数字、下划线，长度 1-15');
    }
    return {
      target: stripped,
      normalizedTarget: stripped.toLowerCase(),
      configJson: {}
    };
  },
  describe(source) {
    return `🐦 twitter:${source.normalizedTarget}`;
  }
};
