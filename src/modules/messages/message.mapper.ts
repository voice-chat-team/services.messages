import { Injectable } from '@nestjs/common';
import type {
  Attachment,
  Message,
} from '@voice-chat/contracts/gen/ts/messages';
import type {
  Message as MessageRecord,
  MessageAttachment,
} from 'prisma/generated/client';
import { FileClientGrpc } from '../file/file.grpc';

export type MessageEntity = MessageRecord & {
  attachments?: MessageAttachment[];
};

@Injectable()
export class MessageMapper {
  constructor(private readonly fileClient: FileClientGrpc) {}

  async toProto(message: MessageEntity, withUrls = true): Promise<Message> {
    const attachments = await Promise.all(
      (message.attachments ?? []).map((a) =>
        this._attachmentToProto(a, withUrls),
      ),
    );

    return {
      id: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      senderId: message.senderId,
      content: message.content,
      isEdited: message.isEdited,
      isDeleted: message.isDeleted,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      attachments,
    };
  }

  private async _attachmentToProto(
    attachment: MessageAttachment,
    withUrl: boolean,
  ): Promise<Attachment> {
    let url = '';

    if (withUrl) {
      try {
        const res = await this.fileClient.call('getDownloadUrl', {
          fileId: attachment.fileId,
          userId: '',
        });
        url = res.url;
      } catch (error) {
        // Сообщение должно отдаваться, даже если ссылка не выдалась
        console.error('Не удалось получить ссылку на файл:', error);
      }
    }

    return {
      fileId: attachment.fileId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: Number(attachment.sizeBytes),
      url,
    };
  }
}
