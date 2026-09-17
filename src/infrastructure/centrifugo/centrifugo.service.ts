import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class CentrifugoService {
  private readonly _CENTRIFUGO_URL: string;
  private readonly _CENTRIFUGO_API_KEY: string;

  constructor(private readonly configService: ConfigService) {
    this._CENTRIFUGO_URL = configService.getOrThrow<string>('CENTRIFUGO_URL');
    this._CENTRIFUGO_API_KEY =
      configService.getOrThrow<string>('CENTRIFUGO_API_KEY');
  }

  async publish(channel: string, data: unknown) {
    try {
      await axios.post(
        this._CENTRIFUGO_URL + '/api/publish',
        {
          channel: channel,
          data: data,
        },
        {
          headers: {
            Authorization: `apikey ${this._CENTRIFUGO_API_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
      return true;
    } catch (error) {
      console.error('Ошибка отправки в Centrifugo:', error);
      return false;
    }
  }
}
