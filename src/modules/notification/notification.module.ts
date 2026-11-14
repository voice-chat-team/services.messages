import { Global, Module } from '@nestjs/common';
import { GrpcModule } from '@voice-chat/common/dist/grpc';
import { NotificationGrpcClient } from './notification.grpc';

@Global()
@Module({
  imports: [GrpcModule.register(['NOTIFICATION_PACKAGE'])],
  providers: [NotificationGrpcClient],
  exports: [NotificationGrpcClient],
})
export class NotificationModule {}
