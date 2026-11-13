import { Injectable, Logger } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { InjectGrpcClient } from '@voice-chat/common';
import type {
  EnqueueMessagePushRequest,
  NotificationServiceClient,
} from '@voice-chat/contracts/gen/ts/notification';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class MessagePushClient {
  private readonly logger = new Logger(MessagePushClient.name);

  constructor(
    @InjectGrpcClient('NOTIFICATION_PACKAGE')
    private readonly client: ClientGrpc,
  ) {}

  async enqueue(request: EnqueueMessagePushRequest): Promise<void> {
    try {
      const service = this.client.getService<NotificationServiceClient>(
        'NotificationService',
      );
      const response = await lastValueFrom(
        service.enqueueMessagePush(request).pipe(timeout(2_000)),
      );
      if (!response.status) throw new Error('Push job was not accepted');
    } catch (error) {
      this.logger.warn(
        `Push job handoff failed for message ${request.messageId}`,
        error,
      );
    }
  }
}
