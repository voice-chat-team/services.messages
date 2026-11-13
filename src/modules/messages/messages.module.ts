import { ReactionsService } from './reactions.service';
import { Module } from '@nestjs/common';
import { MessageEventsDispatcher } from './events/message-events.dispatcher';
import { MessageMapper } from './message.mapper';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { GrpcModule } from '@voice-chat/common';
import { MessagePushClient } from './message-push.client';

@Module({
  imports: [GrpcModule.register(['NOTIFICATION_PACKAGE'])],
  controllers: [MessagesController],
  providers: [
    MessagePushClient,
    ReactionsService,
    MessagesService,
    MessageMapper,
    MessageEventsDispatcher,
  ],
})
export class MessagesModule {}
