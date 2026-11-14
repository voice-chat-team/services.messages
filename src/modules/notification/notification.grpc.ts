import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import {
  AbstractGrpcClient,
  InjectGrpcClient,
} from '@voice-chat/common/dist/grpc';
import type {
  EnqueuePushRequest,
  NotificationServiceClient,
} from '@voice-chat/contracts/gen/ts/notification';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class NotificationGrpcClient extends AbstractGrpcClient<NotificationServiceClient> {
  constructor(
    @InjectGrpcClient('NOTIFICATION_PACKAGE')
    private readonly pushClient: ClientGrpc,
  ) {
    super(pushClient, 'NotificationService');
  }

  enqueuePush(request: EnqueuePushRequest) {
    const service = this.pushClient.getService<NotificationServiceClient>(
      'NotificationService',
    );
    return lastValueFrom(service.enqueuePush(request).pipe(timeout(2_000)));
  }
}
