import { ReactionsService } from './reactions.service';
import type {
  AddReactionRequest,
  AddReactionResponse,
  RemoveReactionRequest,
  RemoveReactionResponse,
  GetReactionUsersRequest,
} from '@voice-chat/contracts/gen/ts/messages';
import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import type {
  DeleteMessageRequest,
  DeleteMessageResponse,
  GetAttachmentDownloadUrlRequest,
  GetAttachmentDownloadUrlResponse,
  GetChannelMessagesRequest,
  GetChannelMessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
  UpdateMessageRequest,
  UpdateMessageResponse,
} from '@voice-chat/contracts/gen/ts/messages';
import { MessagesService } from './messages.service';

@Controller()
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly reactions: ReactionsService,
  ) {}

  @GrpcMethod('MessageService', 'AddReaction')
  addReaction(request: AddReactionRequest): Promise<AddReactionResponse> {
    return this.reactions.change(request, true);
  }

  @GrpcMethod('MessageService', 'RemoveReaction')
  removeReaction(
    request: RemoveReactionRequest,
  ): Promise<RemoveReactionResponse> {
    return this.reactions.change(request, false);
  }

  @GrpcMethod('MessageService', 'GetReactionUsers')
  getReactionUsers(request: GetReactionUsersRequest) {
    return this.reactions.getReactionUsers(request);
  }

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

  @GrpcMethod('MessageService', 'GetAttachmentDownloadUrl')
  getAttachmentDownloadUrl(
    request: GetAttachmentDownloadUrlRequest,
  ): Promise<GetAttachmentDownloadUrlResponse> {
    return this.messagesService.getAttachmentDownloadUrl(request);
  }
}
