import { Module } from '@nestjs/common';
import { MessageEventsDispatcher } from './events/message-events.dispatcher';
import { MessageMapper } from './message.mapper';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  controllers: [MessagesController],
  providers: [MessagesService, MessageMapper, MessageEventsDispatcher],
})
export class MessagesModule {}
