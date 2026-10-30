import type { DataConnection } from './connection.js';
import { SubscriptionManager } from './subscription-manager.js';
import { DataError, type Unsubscribe } from './types.js';
import { readBalance, solanaOptions, validAddress } from './solana.protocol.js';
import type {
  NativeBalanceSnapshot,
  TokenBalanceSnapshot,
  NativeBalanceSubscriptionOptions,
  TokenBalanceSubscriptionOptions,
} from './solana.contracts.js';

export class SolanaSubscriptions extends SubscriptionManager<
  NativeBalanceSnapshot | TokenBalanceSnapshot
> {
  constructor(connection: DataConnection) {
    super(connection);
  }
  subscribeBalance(
    options: NativeBalanceSubscriptionOptions,
  ): Promise<Unsubscribe> {
    return this.add(options);
  }
  subscribeTokenBalance(
    options: TokenBalanceSubscriptionOptions,
  ): Promise<Unsubscribe> {
    return this.add(options);
  }
  private add(
    options: NativeBalanceSubscriptionOptions | TokenBalanceSubscriptionOptions,
  ): Promise<Unsubscribe> {
    if (typeof options.onUpdate !== 'function')
      throw new DataError('invalid_options', 'onUpdate is required.');
    const token = 'mint' in options;
    const params: ReturnType<typeof solanaOptions> & {
      address: string;
      mint?: string;
      initialSnapshot?: boolean;
    } = {
      ...solanaOptions(options),
      address: options.address,
      ...(token
        ? { mint: options.mint }
        : { initialSnapshot: options.initialSnapshot ?? true }),
    };
    if (
      !validAddress(params.address) ||
      (token && !validAddress(params.mint)) ||
      (!token && typeof params.initialSnapshot !== 'boolean')
    )
      throw new DataError('invalid_params', 'Invalid Solana subscription.');
    const key = [
      params.network,
      params.commitment,
      params.address,
      params.mint ?? 'native',
    ].join('|');
    return this.subscribe(
      key,
      {
        method: token
          ? 'solana.subscribeTokenBalance'
          : 'solana.subscribeBalance',
        notification: token
          ? 'solana.tokenBalanceNotification'
          : 'solana.balanceNotification',
        unsubscribe: token
          ? 'solana.unsubscribeTokenBalance'
          : 'solana.unsubscribeBalance',
        params,
        parse: (value): NativeBalanceSnapshot | TokenBalanceSnapshot =>
          readBalance(value, params),
        slot: (value): number => value.context.slot,
      },
      {
        ...options,
        onUpdate: (value): void => {
          if ('mint' in options && 'mint' in value) options.onUpdate(value);
          else if (!('mint' in options) && 'asset' in value)
            options.onUpdate(value);
        },
      },
    );
  }
}
