import type { BinancePriceSnapshot } from './contracts.js';
import type { DataConnection } from './connection.js';
import { readPrice, validateStream } from './binance.protocol.js';
import { SubscriptionManager } from './subscription-manager.js';
import type { BinanceSubscriptionOptions, Unsubscribe } from './types.js';

export class BinanceSubscriptions extends SubscriptionManager<BinancePriceSnapshot> {
  constructor(connection: DataConnection) {
    super(connection);
  }
  subscribePrice(options: BinanceSubscriptionOptions): Promise<Unsubscribe> {
    validateStream(options.stream);
    const stream = options.stream;
    return this.subscribe(
      stream,
      {
        method: 'binance.subscribePrice',
        notification: 'binance.priceNotification',
        unsubscribe: 'binance.unsubscribePrice',
        params: { stream },
        parse: (value): BinancePriceSnapshot => readPrice(value, stream),
      },
      options,
    );
  }
}
