import type { Destination, MonitorSource } from '@prisma/client';
import { InlineKeyboard } from 'grammy';
import { getAdapter } from '../monitors/registry.js';
import { encodeCallback } from './callback-data.js';

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 监控列表', encodeCallback({ action: 'src.list' }))
    .text('➕ 添加监控', encodeCallback({ action: 'add.start' }))
    .row()
    .text('📡 推送目标', encodeCallback({ action: 'dest.list' }))
    .text('❓ 帮助', encodeCallback({ action: 'help' }));
}

export function sourceListKeyboard(sources: MonitorSource[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const source of sources) {
    kb.text(`#${source.id} ${describeShort(source)}`, encodeCallback({ action: 'src.show', id: source.id })).row();
  }
  kb.text('⬅ 返回', encodeCallback({ action: 'menu' }));
  return kb;
}

export function sourceActionsKeyboard(source: MonitorSource): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ 订阅推送目标', encodeCallback({ action: 'src.subs', id: source.id }))
    .row()
    .text(source.enabled ? '⏸ 停用' : '▶️ 启用', encodeCallback({ action: 'src.toggle', id: source.id }))
    .text('🗑 删除', encodeCallback({ action: 'src.delete', id: source.id }))
    .row()
    .text('⬅ 返回列表', encodeCallback({ action: 'src.list' }));
}

export function subscriptionPickerKeyboard(
  sourceId: number,
  destinations: Destination[],
  selectedIds: ReadonlySet<number>
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dest of destinations) {
    const checked = selectedIds.has(dest.id) ? '☑' : '☐';
    const label = `${checked} ${dest.title ?? dest.telegramChatId}`;
    kb.text(label, encodeCallback({ action: 'src.sub.toggle', id: sourceId, arg: String(dest.id) })).row();
  }
  kb.text('💾 完成', encodeCallback({ action: 'src.show', id: sourceId }));
  return kb;
}

export function destinationListKeyboard(destinations: Destination[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const dest of destinations) {
    const status = dest.enabled ? '✅' : '⏸';
    kb.text(`${status} ${dest.title ?? dest.telegramChatId}`, encodeCallback({ action: 'dest.toggle', id: dest.id }))
      .row();
  }
  kb.text('⬅ 返回', encodeCallback({ action: 'menu' }));
  return kb;
}

export function addTypePickerKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🐦 Twitter', encodeCallback({ action: 'add.type', arg: 'twitter' }))
    .text('🌐 Website', encodeCallback({ action: 'add.type', arg: 'website' }))
    .text('📜 Contract', encodeCallback({ action: 'add.type', arg: 'contract' }))
    .row()
    .text('⬅ 取消', encodeCallback({ action: 'menu' }));
}

export function destinationDiscoveryKeyboard(destinationId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ 启用', encodeCallback({ action: 'dest.toggle', id: destinationId }))
    .text('❌ 忽略', encodeCallback({ action: 'dest.ignore', id: destinationId }));
}

function describeShort(source: MonitorSource): string {
  const adapter = getAdapter(source.type);
  return adapter.describe({
    type: source.type,
    target: source.target,
    normalizedTarget: source.normalizedTarget,
    configJson: (source.configJson ?? {}) as Record<string, unknown>
  });
}
