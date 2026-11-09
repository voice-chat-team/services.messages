import { Global, Module } from '@nestjs/common';
import { GrpcModule } from '@voice-chat/common';
import { UserClientGrpc } from './user.grpc';

@Global()
@Module({
  imports: [GrpcModule.register(['USER_PACKAGE'])],
  providers: [UserClientGrpc],
  exports: [UserClientGrpc],
})
export class UserModule {}
