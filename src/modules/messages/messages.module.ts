import { ReactionsService } from './reactions.service';
import { Module } from '@nestjs/common';
import { MessageEventsDispatcher } from './events/message-events.dispatcher';
import { MessageMapper } from './message.mapper';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagePushDispatcher } from './push/message-push.dispatcher';

@Module({
  controllers: [MessagesController],
  providers: [
    MessagePushDispatcher,
    ReactionsService,
    MessagesService,
    MessageMapper,
    MessageEventsDispatcher,
  ],
})
export class MessagesModule {}
