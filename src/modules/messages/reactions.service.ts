import { Injectable } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { RpcStatus } from '@voice-chat/common';
import { REACTION_EMOJIS } from '@voice-chat/contracts';
import type {
  AddReactionRequest,
  RemoveReactionRequest,
  GetReactionUsersRequest,
} from '@voice-chat/contracts/gen/ts/messages';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { UserClientGrpc } from '../user/user.grpc';
import { MessagesService } from './messages.service';
import { MessageEventsDispatcher } from './events/message-events.dispatcher';

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly users: UserClientGrpc,
    private readonly events: MessageEventsDispatcher,
  ) {}

  private validateEmoji(emoji: string) {
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji))
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Недопустимая реакция',
      });
  }

  async change(
    request: AddReactionRequest | RemoveReactionRequest,
    add: boolean,
  ) {
    this.validateEmoji(request.emoji);

    await this.messages.checkReactionAccess(request);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT id FROM messages WHERE id = $1 FOR UPDATE',
        request.messageId,
      );
      const message = await tx.message.findUniqueOrThrow({
        where: { id: request.messageId },
      });

      if (message.isDeleted)
        throw new RpcException({
          code: RpcStatus.NOT_FOUND,
          details: 'Сообщение удалено',
        });

      const where = {
        messageId: request.messageId,
        userId: request.userId,
        emoji: request.emoji,
      };
      const changed = add
        ? (
            await tx.messageReaction.createMany({
              data: [where],
              skipDuplicates: true,
            })
          ).count
        : (await tx.messageReaction.deleteMany({ where })).count;
      let version = message.reactionsVersion;

      if (changed) {
        await tx.$executeRawUnsafe(
          'UPDATE messages SET reactions_version = reactions_version + 1 WHERE id = $1',
          message.id,
        );
        version++;

        await tx.messageOutbox.create({
          data: {
            type: 'MESSAGE_REACTION_UPDATED',
            messageId: message.id,
            meta: { emoji: request.emoji },
            nextAttemptAt: new Date(),
          },
        });
      }

      const count = await tx.messageReaction.count({
        where: { messageId: message.id, emoji: request.emoji },
      });

      return {
        messageId: message.id,
        emoji: request.emoji,
        count,
        reacted: add,
        version,
      };
    });

    this.events.kick();

    return result;
  }

  async getReactionUsers(request: GetReactionUsersRequest) {
    if (request.emoji) this.validateEmoji(request.emoji);
    await this.messages.checkReactionAccess(request);

    const limit = Math.min(Math.max(request.limit || 30, 1), 100);
    const where = {
      messageId: request.messageId,
      ...(request.emoji ? { emoji: request.emoji } : {}),
    };

    const cursor = request.cursor
      ? await this.prisma.messageReaction.findFirst({
          where: { ...where, id: request.cursor },
        })
      : null;

    if (request.cursor && !cursor)
      throw new RpcException({
        code: RpcStatus.INVALID_ARGUMENT,
        details: 'Курсор устарел. Обновите список',
      });

    const rows = await this.prisma.messageReaction.findMany({
      where: {
        ...where,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { gt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const profiles = page.length
      ? (
          await this.users.call('getRangeUsersById', {
            usersId: [...new Set(page.map((r) => r.userId))],
          })
        ).users
      : [];
    return {
      users: page.map((row) => ({
        userId: row.userId,
        emoji: row.emoji,
        createdAt: row.createdAt.toISOString(),
        user: profiles.find((u) => u.id === row.userId),
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : '',
    };
  }
}
