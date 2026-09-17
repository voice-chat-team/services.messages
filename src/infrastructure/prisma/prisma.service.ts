import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'prisma/generated/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly configServer: ConfigService) {
    const adapter = new PrismaPg({
      host: configServer.getOrThrow<string>('POSTGRES_HOST'),
      port: configServer.getOrThrow<number>('POSTGRES_PORT'),
      user: configServer.getOrThrow<string>('POSTGRES_USER'),
      password: configServer.getOrThrow<string>('POSTGRES_PASSWORD'),
      database: configServer.getOrThrow<string>('POSTGRES_DB'),
    });
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
    } catch (error) {
      console.error(error);
    }
  }

  async onModuleDestroy() {
    try {
      await this.$disconnect();
    } catch (error) {
      console.error(error);
    }
  }
}
