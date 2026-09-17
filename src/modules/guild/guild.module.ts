import { Global, Module } from '@nestjs/common';
import { GrpcModule } from '@voice-chat/common';
import { GuildClientGrpc } from './guild.grpc';

@Global()
@Module({
  imports: [GrpcModule.register(['GUILD_PACKAGE'])],
  providers: [GuildClientGrpc],
  exports: [GuildClientGrpc],
})
export class GuildModule {}
