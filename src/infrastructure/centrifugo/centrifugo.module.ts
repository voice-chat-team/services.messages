import { Global, Module } from '@nestjs/common';
import { CentrifugoService } from './centrifugo.service';

@Global()
@Module({
  providers: [CentrifugoService],
  exports: [CentrifugoService],
})
export class CentrifugoModule {}
