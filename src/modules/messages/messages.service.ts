import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import type {
  DeleteMessageRequest,
  GetChannelMessagesRequest,
  Message,
  SendMessageRequest,
  UpdateMessageRequest,
} from '@voice-chat/contracts/gen/messages';
import type { Message as MessageEntity } from 'prisma/generated/client';
import { CentrifugoService } from 'src/infrastructure/centrifugo/centrifugo.service';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GuildClientGrpc } from '../guild/guild.grpc';
import { ChannelType } from '@voice-chat/contracts/dist/constants';

const DEFAULT_MESSAGES_LIMIT = 50;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guildClient: GuildClientGrpc,
    private readonly centrifugoClient: CentrifugoService,
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<Message> {
    const { channelId, guildId, senderId, content } = request;

    await this._checkTextChannel(guildId, channelId);
    await this._checkMember(guildId, senderId);

    try {
      const message = await this.prisma.message.create({
        data: { channelId, guildId, senderId, content },
      });

      await this.centrifugoClient.publish(`guild-channel:${channelId}`, {
        type: 'MESSAGE_CREATED',
        payload: message,
      });

      return this._toProto(message);
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось отправить сообщение',
      });
    }
  }

  async getChannelMessages(
    request: GetChannelMessagesRequest,
  ): Promise<Message[]> {
    const { channelId, guildId, beforeMessageId, limit } = request;

    await this._checkTextChannel(guildId, channelId);

    const cursor = beforeMessageId
      ? await this._getMessageOrThrow(beforeMessageId, guildId)
      : undefined;

    const messages = await this.prisma.message.findMany({
      where: {
        channelId,
        isDeleted: false,
        ...(cursor && { createdAt: { lt: cursor.createdAt } }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit > 0 ? limit : DEFAULT_MESSAGES_LIMIT,
    });

    return messages.map((message) => this._toProto(message));
  }

  async updateMessage(request: UpdateMessageRequest): Promise<Message> {
    const { messageId, guildId, userId, content } = request;

    const existing = await this._getMessageOrThrow(messageId, guildId);
    this._checkAuthor(existing, userId);
    await this._checkMember(guildId, userId);

    try {
      const message = await this.prisma.message.update({
        where: { id: messageId },
        data: { content, isEdited: true },
      });

      await this.centrifugoClient.publish(
        `guild-channel:${existing.channelId}`,
        { type: 'MESSAGE_UPDATED', payload: message },
      );

      return this._toProto(message);
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось обновить сообщение',
      });
    }
  }

  async deleteMessage(request: DeleteMessageRequest): Promise<boolean> {
    const { messageId, guildId, userId } = request;

    const existing = await this._getMessageOrThrow(messageId, guildId);
    this._checkAuthor(existing, userId);
    await this._checkMember(guildId, userId);

    try {
      const message = await this.prisma.message.update({
        where: { id: messageId },
        data: { isDeleted: true },
      });

      await this.centrifugoClient.publish(
        `guild-channel:${existing.channelId}`,
        { type: 'MESSAGE_DELETED', payload: message },
      );

      return true;
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось удалить сообщение',
      });
    }
  }

  private async _checkTextChannel(guildId: string, channelId: string) {
    const { channels } = await this.guildClient.call('getGuildChannels', {
      guildId,
    });

    const channel = channels.find((c) => c.id === channelId);

    if (!channel) {
      throw new RpcException({
        code: RpcStatus.NOT_FOUND,
        details: 'Канал не найден',
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (channel.type !== ChannelType.TEXT) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Сообщения можно отправлять только в текстовый канал',
      });
    }

    return channel;
  }

  private async _checkMember(guildId: string, userId: string) {
    const { memberInfo } = await this.guildClient.call('getMemberById', {
      guildId,
      userId,
    });

    if (!memberInfo || memberInfo.isBanned) {
      throw new RpcException({
        code: RpcStatus.PERMISSION_DENIED,
        details: 'Вы не являетесь участником сервера',
      });
    }

    return memberInfo;
  }

  private _checkAuthor(message: MessageEntity, userId: string) {
    if (message.senderId !== userId) {
      throw new RpcException({
        code: RpcStatus.PERMISSION_DENIED,
        details: 'Редактировать можно только своё сообщение',
      });
    }
  }

  private async _getMessageOrThrow(
    messageId: string,
    guildId: string,
  ): Promise<MessageEntity> {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message || message.isDeleted || message.guildId !== guildId) {
      throw new RpcException({
        code: RpcStatus.NOT_FOUND,
        details: 'Сообщение не найдено',
      });
    }

    return message;
  }

  private _toProto(message: MessageEntity): Message {
    return {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    };
  }
}
