import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { AbstractGrpcClient, InjectGrpcClient } from '@voice-chat/common';
import type { UserServiceClient } from '@voice-chat/contracts/gen/ts/user';

@Injectable()
export class UserClientGrpc extends AbstractGrpcClient<UserServiceClient> {
  constructor(@InjectGrpcClient('USER_PACKAGE') client: ClientGrpc) {
    super(client, 'UserService');
  }
}
