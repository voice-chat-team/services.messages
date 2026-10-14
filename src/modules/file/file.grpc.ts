import { Injectable } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { AbstractGrpcClient, InjectGrpcClient } from '@voice-chat/common';
import type { FileServiceClient } from '@voice-chat/contracts/gen/ts/files';

@Injectable()
export class FileClientGrpc extends AbstractGrpcClient<FileServiceClient> {
  constructor(@InjectGrpcClient('FILE_PACKAGE') client: ClientGrpc) {
    super(client, 'FileService');
  }
}
