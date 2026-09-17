import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  DeleteMessageRequest,
  DeleteMessageResponse,
  GetChannelMessagesRequest,
  GetChannelMessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateMessageRequest,
  UpdateMessageResponse,
} from '@voice-chat/contracts/gen/messages';
import { MessagesService } from './messages.service';

@Controller()
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @GrpcMethod('MessageService', 'SendMessage')
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const message = await this.messagesService.sendMessage(request);

    return { message };
  }

  @GrpcMethod('MessageService', 'GetChannelMessages')
  async getChannelMessages(
    request: GetChannelMessagesRequest,
  ): Promise<GetChannelMessagesResponse> {
    const messages = await this.messagesService.getChannelMessages(request);

    return { messages };
  }

  @GrpcMethod('MessageService', 'UpdateMessage')
  async updateMessage(
    request: UpdateMessageRequest,
  ): Promise<UpdateMessageResponse> {
    const message = await this.messagesService.updateMessage(request);

    return { message };
  }

  @GrpcMethod('MessageService', 'DeleteMessage')
  async deleteMessage(
    request: DeleteMessageRequest,
  ): Promise<DeleteMessageResponse> {
    const success = await this.messagesService.deleteMessage(request);

    return { success };
  }
}
