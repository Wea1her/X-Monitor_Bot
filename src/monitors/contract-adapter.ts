import type { MonitorAdapter } from './adapter.js';
import { ValidationError } from './adapter.js';

const SUPPORTED_CHAINS = new Set(['eth', 'bsc', 'sol']);
const EVM_ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const contractAdapter: MonitorAdapter = {
  type: 'contract',
  async validateTarget(input) {
    const parts = input.trim().split(/\s+/);
    if (parts.length !== 2) {
      throw new ValidationError('用法：<chain> <address>，例如 eth 0x...');
    }
    const [chainRaw, addressRaw] = parts as [string, string];
    const chain = chainRaw.toLowerCase();
    if (!SUPPORTED_CHAINS.has(chain)) {
      throw new ValidationError(`不支持的链：${chainRaw}（支持 ${[...SUPPORTED_CHAINS].join(' / ')}）`);
    }
    if (chain === 'sol') {
      if (!SOL_ADDR_RE.test(addressRaw)) {
        throw new ValidationError('Solana 地址格式不正确');
      }
      return {
        target: input.trim(),
        normalizedTarget: `${chain}:${addressRaw}`,
        configJson: { chain, address: addressRaw }
      };
    }
    if (!EVM_ADDR_RE.test(addressRaw)) {
      throw new ValidationError(`${chain.toUpperCase()} 地址必须是 0x 开头的 40 位十六进制`);
    }
    const lower = addressRaw.toLowerCase();
    return {
      target: input.trim(),
      normalizedTarget: `${chain}:${lower}`,
      configJson: { chain, address: lower }
    };
  },
  describe(source) {
    return `📜 contract:${source.normalizedTarget} ⚠️ worker 暂未上线`;
  }
};
