import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { RpcStatus } from '@voice-chat/common';
import { randomUUID } from 'node:crypto';
import type { MessagePushOutbox } from 'prisma/generated/client';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GuildClientGrpc } from '../../guild/guild.grpc';
import { NotificationGrpcClient } from '../../notification/notification.grpc';

const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 10;
const RETENTION_MS = 7 * 86_400_000;
export const MESSAGE_PUSH_TTL_MS = 5 * 60_000;

@Injectable()
export class MessagePushDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(MessagePushDispatcher.name);
  private running?: Promise<void>;
  private rerun = false;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guild: GuildClientGrpc,
    private readonly notification: NotificationGrpcClient,
  ) {}

  onApplicationBootstrap(): void {
    this.kick();
  }

  @Interval(1_000)
  poll(): void {
    this.kick();
  }

  kick(): void {
    if (this.stopped) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = this.drain()
      .catch(() => this.logger.error('Push outbox processing failed'))
      .finally(() => {
        this.running = undefined;
        if (this.rerun) {
          this.rerun = false;
          this.kick();
        }
      });
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    await this.running;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeExpired(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.prisma.messagePushOutbox.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - RETENTION_MS) } },
      });
    } catch {
      this.logger.error('Push outbox cleanup failed');
    }
  }

  private async drain(): Promise<void> {
    while (!this.stopped) {
      const leaseId = randomUUID();
      const [job] = await this.prisma.$queryRaw<MessagePushOutbox[]>`
        UPDATE message_push_outbox
        SET next_attempt_at = (now() AT TIME ZONE 'UTC') + ${LEASE_MS}::int * interval '1 millisecond',
            lease_id = ${leaseId}, attempts = attempts + 1
        WHERE message_id = (
          SELECT message_id FROM message_push_outbox
          WHERE completed_at IS NULL
            AND next_attempt_at <= (now() AT TIME ZONE 'UTC')
            AND expires_at > (now() AT TIME ZONE 'UTC')
            AND attempts < ${MAX_ATTEMPTS}
          ORDER BY next_attempt_at, message_id
          LIMIT 1 FOR UPDATE SKIP LOCKED
        )
        RETURNING message_id AS "messageId", guild_id AS "guildId",
          channel_id AS "channelId", sender_id AS "senderId", title, body,
          created_at AS "createdAt", expires_at AS "expiresAt", attempts,
          next_attempt_at AS "nextAttemptAt", lease_id AS "leaseId",
          completed_at AS "completedAt", last_error AS "lastError"
      `;
      if (!job) return;
      await this.process(job, leaseId);
    }
  }

  private async process(
    job: MessagePushOutbox,
    leaseId: string,
  ): Promise<void> {
    const where = { messageId: job.messageId, leaseId };
    if (this.stopped) return;
    try {
      const { userIds } = await this.guild.call('getChannelRecipients', {
        guildId: job.guildId,
        channelId: job.channelId,
      });

      if (this.stopped) return;

      const recipientUserIds = [...new Set(userIds)].filter(
        (id) => id !== job.senderId,
      );

      if (!recipientUserIds.length) {
        await this.prisma.messagePushOutbox.deleteMany({ where });
        return;
      }
      // Fence a stale worker and check TTL again after the guild call.
      const { count } = await this.prisma.messagePushOutbox.updateMany({
        where: { ...where, expiresAt: { gt: new Date() } },
        data: { nextAttemptAt: new Date(Date.now() + LEASE_MS) },
      });

      if (!count) return;

      const response = await this.notification.enqueuePush({
        id: job.messageId,
        recipientUserIds,
        title: job.title,
        body: job.body,
        createdAt: job.createdAt.toISOString(),
        data: {
          message: {
            messageId: job.messageId,
            guildId: job.guildId,
            channelId: job.channelId,
            senderId: job.senderId,
          },
        },
      });

      if (!response.status) throw new Error('Push handoff rejected');
      await this.prisma.messagePushOutbox.deleteMany({ where });
    } catch (error: unknown) {
      const detail = error instanceof RpcException ? error.getError() : error;
      const code =
        typeof detail === 'object' && detail !== null && 'code' in detail
          ? String(detail.code)
          : error instanceof Error && error.name === 'TimeoutError'
            ? 'timeout'
            : 'unknown';

      const terminal = [
        RpcStatus.NOT_FOUND,
        RpcStatus.PERMISSION_DENIED,
        RpcStatus.INVALID_ARGUMENT,
      ].some((status) => String(status) === code);

      const completed = terminal || job.attempts >= MAX_ATTEMPTS;

      await this.prisma.messagePushOutbox.updateMany({
        where,
        data: {
          leaseId: null,
          completedAt: completed ? new Date() : undefined,
          nextAttemptAt: new Date(
            Date.now() +
              Math.min(1_000 * 2 ** (job.attempts - 1), 60_000) +
              Math.random() * 1_000,
          ),
          lastError: code,
        },
      });
      this.logger.warn(
        `Push outbox ${job.messageId}: ${completed ? 'skipped' : 'retry scheduled'} (${code})`,
      );
    }
  }
}
