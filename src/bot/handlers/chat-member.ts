import type { Api, Context } from 'grammy';
import type { DestinationService } from '../../services/destination-service.js';
import { destinationDiscoveryKeyboard } from '../keyboards.js';
import { newDestinationCard } from '../messages.js';

const ADDED_STATUSES = new Set(['member', 'administrator', 'restricted']);

export interface ChatMemberDeps {
  botId: number;
  ownerUserIds: number[];
  discover: DestinationService['discover'];
  api: Pick<Api, 'sendMessage'>;
}

export async function handleChatMemberUpdate(
  update: NonNullable<Context['myChatMember']>,
  deps: ChatMemberDeps
): Promise<void> {
  const target = update.new_chat_member;
  if (target.user.id !== deps.botId) return;
  if (!ADDED_STATUSES.has(target.status)) return;
  const chat = update.chat;
  const result = await deps.discover({
    telegramChatId: String(chat.id),
    type: chat.type,
    title: 'title' in chat ? chat.title ?? null : null,
    username: 'username' in chat ? chat.username ?? null : null
  });
  for (const ownerId of deps.ownerUserIds) {
    try {
      await deps.api.sendMessage(ownerId, newDestinationCard(result.destination), {
        reply_markup: destinationDiscoveryKeyboard(result.destination.id)
      });
    } catch (error) {
      console.warn(
        `chat-member: failed to DM owner ${ownerId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
