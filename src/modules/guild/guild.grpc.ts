import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { AbstractGrpcClient, InjectGrpcClient } from '@voice-chat/common';
import type { GuildServiceClient } from '@voice-chat/contracts/gen/guilds';

@Injectable()
export class GuildClientGrpc extends AbstractGrpcClient<GuildServiceClient> {
  constructor(@InjectGrpcClient('GUILD_PACKAGE') client: ClientGrpc) {
    super(client, 'GuildService');
  }
}
