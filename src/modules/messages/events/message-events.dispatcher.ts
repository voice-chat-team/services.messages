/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { NotificationType } from '@voice-chat/contracts/dist/constants';
import type { Message } from '@voice-chat/contracts/gen/ts/messages';
import type { MessageEventType } from 'prisma/generated/client';
import { CentrifugoService } from 'src/infrastructure/centrifugo/centrifugo.service';
import { PrismaService } from 'src/infrastructure/prisma/prisma.service';
import { GuildClientGrpc } from '../../guild/guild.grpc';
import { MessageMapper, type MessageEntity } from '../message.mapper';
import {
  personalMessagesChannel,
  type MessageCreatedMeta,
  type MessageEvent,
} from './message-events';

const POLL_INTERVAL_MS = 1_000;
const BATCH_SIZE = 50;
// Сколько строка считается занятой инстансом, который её взял. Если он упал,
// по истечении аренды строку подберёт кто-то другой.
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 60_000;
// Строки, исчерпавшие попытки, больше не рассылаются, но какое-то время
// хранятся с last_error для разбора.
const DEAD_ROWS_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const BROADCAST_CHUNK_SIZE = 500;
// Список участников кэшируется, чтобы не ходить в сервис гильдий на каждое
// событие. Цена: новый участник начнёт получать события с задержкой до TTL,
// а забаненный — перестанет.
const GUILD_CACHE_TTL_MS = 15_000;
const MESSAGE_PREVIEW_LENGTH = 200;

type OutboxRow = {
  id: bigint;
  type: MessageEventType;
  messageId: string;
  meta: unknown;
  attempts: number;
};

type GuildRecipients = {
  guildName: string;
  userIds: string[];
  expiresAt: number;
};

@Injectable()
export class MessageEventsDispatcher
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private _running = false;
  private _rerun = false;
  private _stopped = false;
  private readonly _guilds = new Map<string, GuildRecipients>();
  // Переходный режим: старые клиенты слушают MESSAGE_* в guild-channel и
  // NEW_GUILD_MESSAGE в личном канале. Выключить (MESSAGE_EVENTS_LEGACY=false)
  // и удалить, когда старых версий клиента не останется.
  private readonly _legacyEvents: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guildClient: GuildClientGrpc,
    private readonly centrifugoClient: CentrifugoService,
    private readonly mapper: MessageMapper,
    configService: ConfigService,
  ) {
    this._legacyEvents =
      configService.get<string>('MESSAGE_EVENTS_LEGACY') !== 'false';
  }

  onApplicationBootstrap() {
    this.kick();
  }

  onModuleDestroy() {
    this._stopped = true;
  }

  // Подстраховка: подбирает повторы после ошибок и строки упавших инстансов.
  // Основной путь — kick() сразу после коммита.
  @Interval(POLL_INTERVAL_MS)
  poll() {
    this.kick();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeDeadRows() {
    if (this._stopped) return;

    try {
      // next_attempt_at у мёртвой строки — время последней попытки плюс
      // backoff, этого достаточно для срока хранения.
      const { count } = await this.prisma.messageOutbox.deleteMany({
        where: {
          attempts: { gte: MAX_ATTEMPTS },
          nextAttemptAt: { lt: new Date(Date.now() - DEAD_ROWS_RETENTION_MS) },
        },
      });

      if (count > 0) {
        console.warn(`Удалено ${count} неотправленных событий из outbox`);
      }
    } catch (error) {
      console.error('Не удалось очистить outbox сообщений:', error);
    }
  }

  // Разбирает outbox, не дожидаясь следующего тика. Вызывается после коммита,
  // чтобы событие ушло сразу.
  kick() {
    if (this._stopped) return;

    if (this._running) {
      this._rerun = true;
      return;
    }

    this._running = true;

    void this._drain()
      .catch((error) =>
        console.error('Ошибка разбора outbox сообщений:', error),
      )
      .finally(() => {
        this._running = false;

        if (this._rerun) {
          this._rerun = false;
          this.kick();
        }
      });
  }

  private async _drain() {
    while (!this._stopped) {
      const rows = await this._claim();

      // Внутри инстанса — строго по порядку записи, чтобы правка не обгоняла
      // создание. Между инстансами порядок не гарантирован, но событие несёт
      // текущее состояние сообщения, а клиент сравнивает updatedAt.
      for (const row of rows) await this._process(row);

      if (rows.length < BATCH_SIZE) return;
    }
  }

  // Prisma хранит DateTime как UTC без зоны, поэтому сравниваем с
  // now() AT TIME ZONE 'UTC' — так не важны ни таймзона сессии, ни то,
  // как драйвер передал бы Date из JS.
  private async _claim(): Promise<OutboxRow[]> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      UPDATE "message_outbox"
      SET "next_attempt_at" =
        (now() AT TIME ZONE 'UTC') + ${LEASE_MS}::int * interval '1 millisecond'
      WHERE "id" IN (
        SELECT "id" FROM "message_outbox"
        WHERE "next_attempt_at" <= (now() AT TIME ZONE 'UTC')
          AND "attempts" < ${MAX_ATTEMPTS}
        ORDER BY "id"
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "type", "message_id" AS "messageId", "meta", "attempts"
    `;

    return rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private async _process(row: OutboxRow) {
    try {
      await this._dispatch(row);
      await this.prisma.messageOutbox.delete({ where: { id: row.id } });
    } catch (error) {
      const attempts = row.attempts + 1;

      console.error(
        `Не удалось разослать ${row.type} (${row.messageId}), попытка ${attempts}/${MAX_ATTEMPTS}:`,
        error,
      );

      await this.prisma.messageOutbox.update({
        where: { id: row.id },
        data: {
          attempts,
          nextAttemptAt: new Date(
            Date.now() + Math.min(1_000 * 2 ** attempts, MAX_BACKOFF_MS),
          ),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async _dispatch(row: OutboxRow) {
    const message = await this.prisma.message.findUnique({
      where: { id: row.messageId },
      include: { attachments: true },
    });

    if (!message) return;

    // Событие собирается из текущего состояния сообщения. Если оно уже
    // удалено, создание и правка не нужны: клиенты получат MESSAGE_DELETED.
    if (message.isDeleted && row.type !== 'MESSAGE_DELETED') return;

    const guild = await this._getGuildRecipients(message.guildId);
    const proto = await this.mapper.toProto(message, !message.isDeleted);

    const event: MessageEvent =
      row.type === 'MESSAGE_CREATED'
        ? {
            type: 'MESSAGE_CREATED',
            payload: {
              ...(row.meta as MessageCreatedMeta),
              guildName: guild.guildName,
              message: proto,
            },
          }
        : { type: row.type, payload: { message: proto } };

    await this._broadcast(guild.userIds, event);

    if (this._legacyEvents) {
      await this._publishLegacy(row, message, proto, guild);
    }
  }

  private async _publishLegacy(
    row: OutboxRow,
    message: MessageEntity,
    proto: Message,
    guild: GuildRecipients,
  ) {
    const published = await this.centrifugoClient.publish(
      `guild-channel:${message.channelId}`,
      { type: row.type, payload: proto },
    );

    if (!published) throw new Error('Centrifugo publish не прошёл');

    if (row.type !== 'MESSAGE_CREATED') return;

    const meta = row.meta as MessageCreatedMeta;

    await this._broadcast(
      guild.userIds.filter((id) => id !== message.senderId),
      {
        type: 'NEW_GUILD_MESSAGE' satisfies keyof typeof NotificationType,
        payload: {
          messageId: message.id,
          guildId: message.guildId,
          guildName: guild.guildName,
          channelId: message.channelId,
          channelName: meta.channelName,
          senderId: message.senderId,
          senderName: meta.senderName,
          senderAvatarUrl: meta.senderAvatarUrl,
          preview: message.content.slice(0, MESSAGE_PREVIEW_LENGTH),
          createdAt: message.createdAt,
        },
      },
    );
  }

  // При повторе после частичного сбоя часть получателей получит событие
  // дважды — клиент применяет события идемпотентно.
  private async _broadcast(userIds: string[], event: unknown) {
    const channels = userIds.map(personalMessagesChannel);

    for (let i = 0; i < channels.length; i += BROADCAST_CHUNK_SIZE) {
      const sent = await this.centrifugoClient.broadcast(
        channels.slice(i, i + BROADCAST_CHUNK_SIZE),
        event,
      );

      if (!sent) throw new Error('Centrifugo broadcast не прошёл');
    }
  }

  private async _getGuildRecipients(guildId: string) {
    const now = Date.now();
    const cached = this._guilds.get(guildId);
    if (cached && cached.expiresAt > now) return cached;

    const [{ members }, { guild }] = await Promise.all([
      this.guildClient.call('getGuildMembers', { guildId }),
      this.guildClient.call('getGuildById', { guildId }),
    ]);

    const entry: GuildRecipients = {
      guildName: guild?.name ?? '',
      userIds: (members ?? []).filter((m) => !m.isBanned).map((m) => m.userId),
      expiresAt: now + GUILD_CACHE_TTL_MS,
    };

    for (const [id, value] of this._guilds) {
      if (value.expiresAt <= now) this._guilds.delete(id);
    }

    this._guilds.set(guildId, entry);

    return entry;
  }
}
