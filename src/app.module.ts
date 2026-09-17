import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CentrifugoModule } from './infrastructure/centrifugo/centrifugo.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { GuildModule } from './modules/guild/guild.module';
import { MessagesModule } from './modules/messages/messages.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV}.local`, '.env'],
    }),
    PrismaModule,
    CentrifugoModule,
    GuildModule,
    MessagesModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
