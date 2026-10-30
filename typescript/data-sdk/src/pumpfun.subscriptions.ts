import type { DataConnection } from './connection.js';
import type {
  PumpfunUpdate,
  PumpfunSubscriptionOptions,
} from './pumpfun.contracts.js';
import { readPumpfunUpdate } from './pumpfun.protocol.js';
import { SubscriptionManager } from './subscription-manager.js';
import { DataError, type Unsubscribe } from './types.js';

export class PumpfunSubscriptions extends SubscriptionManager<PumpfunUpdate> {
  constructor(connection: DataConnection) {
    super(connection);
  }
  subscribeCallouts(options: PumpfunSubscriptionOptions): Promise<Unsubscribe> {
    if (typeof options.onUpdate !== 'function')
      throw new DataError('invalid_options', 'onUpdate is required.');
    return this.subscribe(
      'callouts',
      {
        method: 'pumpfun.subscribeCallouts',
        notification: 'pumpfun.calloutNotification',
        unsubscribe: 'pumpfun.unsubscribeCallouts',
        params: {},
        parse: readPumpfunUpdate,
      },
      options,
    );
  }
}
