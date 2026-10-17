import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import {
  assertGuildMember,
  assertGuildPermission,
  hasGuildPermission,
  RpcStatus,
} from '@voice-chat/common';
import { Permission } from '@voice-chat/contracts';
import type {
  DeleteMessageRequest,
  GetAttachmentDownloadUrlRequest,
  GetAttachmentDownloadUrlResponse,
  GetChannelMessagesRequest,
  Message,
  SendMessageRequest,
  UpdateMessageRequest,
} from '@voice-chat/contracts/gen/ts/messages';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GuildClientGrpc } from '../guild/guild.grpc';
import { FileClientGrpc } from '../file/file.grpc';
import {
  ChannelType,
  FilePurpose,
  FileStatus,
} from '@voice-chat/contracts/dist/constants';
import { MessageEventsDispatcher } from './events/message-events.dispatcher';
import { enqueueMessageEvent } from './events/message-events';
import { MessageMapper, type MessageEntity } from './message.mapper';

const DEFAULT_MESSAGES_LIMIT = 50;
const MAX_ATTACHMENTS = 10;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guildClient: GuildClientGrpc,
    private readonly fileClient: FileClientGrpc,
    private readonly mapper: MessageMapper,
    private readonly events: MessageEventsDispatcher,
  ) {}

  async sendMessage(request: SendMessageRequest): Promise<Message> {
    const { channelId, guildId, senderId, content } = request;
    const attachmentFileIds = request.attachmentFileIds ?? [];

    if (!content.trim() && !attachmentFileIds.length) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Сообщение не может быть пустым',
      });
    }

    const channel = await this._checkTextChannel(guildId, channelId);
    const sender = await this._checkMember(guildId, senderId);

    assertGuildPermission(
      sender,
      Permission.SEND_MESSAGES,
      'У вас нет права отправлять сообщения на этом сервере',
    );

    if (attachmentFileIds.length) {
      assertGuildPermission(
        sender,
        Permission.ATTACH_FILES,
        'У вас нет права прикреплять файлы на этом сервере',
      );
    }

    const files = await this._checkAttachments(attachmentFileIds, senderId);

    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            channelId,
            guildId,
            senderId,
            content,
            attachments: {
              create: files.map((file) => ({
                fileId: file.id,
                fileName: file.fileName,
                contentType: file.contentType,
                sizeBytes: Number(file.sizeBytes),
              })),
            },
          },
          include: { attachments: true },
        });

        await enqueueMessageEvent(tx, {
          type: 'MESSAGE_CREATED',
          messageId: created.id,
          meta: {
            channelName: channel.name,
            senderName: sender.user?.username ?? 'Пользователь',
            senderAvatarUrl: sender.user?.avatarUrl ?? '',
          },
        });

        return created;
      });

      this.events.kick();

      return await this.mapper.toProto(message);
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
    const { channelId, guildId, userId, beforeMessageId, limit } = request;

    await this._checkTextChannel(guildId, channelId);
    await this._checkMember(guildId, userId);

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
      include: { attachments: true },
    });

    return Promise.all(messages.map((message) => this.mapper.toProto(message)));
  }

  async updateMessage(request: UpdateMessageRequest): Promise<Message> {
    const { messageId, guildId, userId, content } = request;

    const existing = await this._getMessageOrThrow(messageId, guildId);
    this._checkAuthor(existing, userId);
    await this._checkMember(guildId, userId);

    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.message.update({
          where: { id: messageId },
          data: { content, isEdited: true },
          include: { attachments: true },
        });

        await enqueueMessageEvent(tx, {
          type: 'MESSAGE_UPDATED',
          messageId,
        });

        return updated;
      });

      this.events.kick();

      return await this.mapper.toProto(message);
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
    const member = await this._checkMember(guildId, userId);

    if (
      existing.senderId !== userId &&
      !hasGuildPermission(member, Permission.DELETE_MESSAGES)
    ) {
      throw new RpcException({
        code: RpcStatus.PERMISSION_DENIED,
        details: 'Удалять чужие сообщения можно только с правом на это',
      });
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.message.update({
          where: { id: messageId },
          data: { isDeleted: true },
        });

        await enqueueMessageEvent(tx, {
          type: 'MESSAGE_DELETED',
          messageId,
        });
      });

      this.events.kick();

      return true;
    } catch (error) {
      console.error(error);
      throw new RpcException({
        code: RpcStatus.INTERNAL,
        details: 'Не удалось удалить сообщение',
      });
    }
  }

  async getAttachmentDownloadUrl(
    request: GetAttachmentDownloadUrlRequest,
  ): Promise<GetAttachmentDownloadUrlResponse> {
    const { fileId, userId } = request;

    const attachment = await this.prisma.messageAttachment.findUnique({
      where: { fileId },
      include: { message: true },
    });

    if (!attachment || attachment.message.isDeleted) {
      throw new RpcException({
        code: RpcStatus.NOT_FOUND,
        details: 'Файл не найден',
      });
    }

    await this._checkMember(attachment.message.guildId, userId);

    return this.fileClient.call('getDownloadUrl', { fileId, userId });
  }

  private async _checkAttachments(fileIds: string[], senderId: string) {
    if (!fileIds.length) return [];

    if (
      fileIds.length > MAX_ATTACHMENTS ||
      new Set(fileIds).size !== fileIds.length
    ) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: `Можно прикрепить не более ${MAX_ATTACHMENTS} разных файлов`,
      });
    }

    const { files } = await this.fileClient.call('getFiles', { fileIds });

    const valid =
      files.length === fileIds.length &&
      files.every(
        (file) =>
          file.ownerId === senderId &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          file.status === FileStatus.READY &&
          // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
          file.purpose === FilePurpose.MESSAGE_ATTACHMENT,
      );

    if (!valid) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Некоторые файлы недоступны для прикрепления',
      });
    }

    const used = await this.prisma.messageAttachment.count({
      where: { fileId: { in: fileIds } },
    });

    if (used > 0) {
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Файл уже прикреплён к другому сообщению',
      });
    }

    return files;
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
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

    assertGuildMember(memberInfo);

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
}
