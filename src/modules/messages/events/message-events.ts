import type { Message } from '@voice-chat/contracts/gen/ts/messages';
import type { MessageEventType, Prisma } from 'prisma/generated/client';

// Все события сообщений идут в личный канал каждого участника сервера,
// включая автора (его другие устройства). Канал постоянно подписан на клиенте,
// поэтому кэш чата обновляется, даже когда сам чат закрыт.
export const personalMessagesChannel = (userId: string) =>
  `personal:#${userId}:messages`;

export type MessageCreatedMeta = {
  channelName: string;
  senderName: string;
  senderAvatarUrl: string;
};

export type MessageCreatedEvent = {
  type: 'MESSAGE_CREATED';
  payload: MessageCreatedMeta & {
    guildName: string;
    message: Message;
  };
};

export type MessageChangedEvent = {
  type: 'MESSAGE_UPDATED' | 'MESSAGE_DELETED';
  payload: { message: Message };
};

export type MessageEvent = MessageCreatedEvent | MessageChangedEvent;

type EnqueueParams =
  | { type: 'MESSAGE_CREATED'; messageId: string; meta: MessageCreatedMeta }
  | { type: 'MESSAGE_UPDATED' | 'MESSAGE_DELETED'; messageId: string };

export const enqueueMessageEvent = (
  tx: Prisma.TransactionClient,
  params: EnqueueParams,
) =>
  tx.messageOutbox.create({
    data: {
      type: params.type satisfies MessageEventType,
      messageId: params.messageId,
      meta: 'meta' in params ? params.meta : undefined,
      nextAttemptAt: new Date(),
    },
  });
