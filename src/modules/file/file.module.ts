import { Global, Module } from '@nestjs/common';
import { GrpcModule } from '@voice-chat/common';
import { FileClientGrpc } from './file.grpc';

@Global()
@Module({
  imports: [GrpcModule.register(['FILE_PACKAGE'])],
  providers: [FileClientGrpc],
  exports: [FileClientGrpc],
})
export class FileModule {}
