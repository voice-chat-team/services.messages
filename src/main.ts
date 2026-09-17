import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { PROTO_PATHS } from '@voice-chat/contracts';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'messages.v1',
      protoPath: PROTO_PATHS.MESSAGES,
      url: '0.0.0.0:5057',
      loader: {
        longs: String,
        enums: String,
      },
    },
  });

  await app.startAllMicroservices();
}
bootstrap();
