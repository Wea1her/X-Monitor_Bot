import type { Destination, MonitorSource } from '@prisma/client';
import { getAdapter } from '../monitors/registry.js';

export const WELCOME = '👋 X Monitor Bot\n选择一个操作：';
export const HELP = [
  '可用命令：',
  '/start /menu - 主菜单',
  '/list - 监控源列表',
  '/destinations - 推送目标列表',
  '/add <type> <target> - 快速添加',
  '/remove <id> - 删除',
  '/enable <id> /disable <id> - 启停',
  '/cancel - 取消向导',
  '',
  '提示：',
  '- Twitter 关注/取关事件需要被监控账号粉丝 > 5000。',
  '- Website / Contract 类型 worker 暂未上线，仅入库不会推送。'
].join('\n');

export const STALE_BUTTON = '按钮已过期，请重新打开菜单 /menu';
export const RETRY = '操作失败，请稍后重试';
export const CANCELLED = '已取消';

export function describeSourceLine(source: MonitorSource): string {
  const adapter = getAdapter(source.type);
  const desc = adapter.describe({
    type: source.type,
    target: source.target,
    normalizedTarget: source.normalizedTarget,
    configJson: (source.configJson ?? {}) as Record<string, unknown>
  });
  const status = source.enabled ? '✅' : '⏸';
  return `#${source.id} ${status} ${desc}`;
}

export function describeDestinationLine(dest: Destination): string {
  const status = dest.enabled ? '✅' : '⏸';
  const name = dest.title ?? dest.telegramChatId;
  return `#${dest.id} ${status} ${name} (${dest.type})`;
}

export function newDestinationCard(dest: Destination): string {
  return [
    '🆕 检测到新的可用推送目标',
    `名称：${dest.title ?? '(无标题)'}`,
    `类型：${dest.type}`,
    `chat_id：${dest.telegramChatId}`,
    '',
    '点击下方按钮启用或忽略。'
  ].join('\n');
}

export function addTargetPrompt(type: string): string {
  switch (type) {
    case 'twitter':
      return '请发送 Twitter 用户名（不带 @）：';
    case 'website':
      return '请发送完整网站 URL（http:// 或 https://）：';
    case 'contract':
      return '请发送 <chain> <address>，例如：eth 0x1234...';
    default:
      return '请发送目标：';
  }
}

export function workerNotAvailableHint(type: string): string | null {
  if (type === 'website' || type === 'contract') {
    return '⚠️ 该监控类型 worker 暂未上线，事件不会被推送。';
  }
  return null;
}
