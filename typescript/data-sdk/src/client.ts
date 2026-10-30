import type {
  PumpfunGetParams,
  PumpfunCalloutsResult,
  PumpfunSubscriptionOptions,
} from './pumpfun.contracts.js';
import { PumpfunSubscriptions } from './pumpfun.subscriptions.js';
import type {
  BinancePriceParams,
  BinancePriceSnapshot,
  DataQuery,
  DataQueryResult,
} from './contracts.js';
import { DataConnection } from './connection.js';
import { prepareQuery } from './queries.js';
import { BinanceSubscriptions } from './binance.subscriptions.js';
import { SolanaSubscriptions } from './solana.subscriptions.js';
import type {
  NativeBalancesOptions,
  TokenBalancesOptions,
  NativeBalancesResult,
  TokenBalancesResult,
  NativeBalanceSubscriptionOptions,
  TokenBalanceSubscriptionOptions,
} from './solana.contracts.js';
import {
  DataError,
  type BatchResult,
  type BinanceSubscriptionOptions,
  type ConnectionSnapshot,
  type DataClientOptions,
  type RequestOptions,
  type Unsubscribe,
} from './types.js';

/** Owns one authenticated data socket. Construction does not perform IO. */
export class DataClient {
  private readonly connection: DataConnection;
  private readonly subscriptions: BinanceSubscriptions;
  private readonly callouts: PumpfunSubscriptions;
  private readonly balances: SolanaSubscriptions;

  constructor(options: DataClientOptions) {
    this.connection = new DataConnection(options, (message) => {
      this.subscriptions.receive(message);
      this.balances.receive(message);
      this.callouts.receive(message);
    });
    this.subscriptions = new BinanceSubscriptions(this.connection);
    this.balances = new SolanaSubscriptions(this.connection);
    this.callouts = new PumpfunSubscriptions(this.connection);
  }

  start(): void {
    this.connection.start();
  }
  close(): void {
    this.subscriptions.close();
    this.balances.close();
    this.callouts.close();
    this.connection.stop();
  }
  stop(): void {
    this.close();
  }
  getSnapshot = (): ConnectionSnapshot => this.connection.getSnapshot();
  onStatusChange = (listener: () => void): (() => void) =>
    this.connection.onStatusChange(listener);

  ping(options?: RequestOptions): Promise<'pong'> {
    return this.request({ method: 'ping' }, options);
  }
  readonly binance = {
    getPrice: (
      params: BinancePriceParams,
      options?: RequestOptions,
    ): Promise<BinancePriceSnapshot> =>
      this.request({ method: 'binance.getPrice', params }, options),
    subscribePrice: (
      options: BinanceSubscriptionOptions,
    ): Promise<Unsubscribe> => this.subscriptions.subscribePrice(options),
  };
  readonly pumpfun = {
    getCallouts: (
      params?: PumpfunGetParams,
      options?: RequestOptions,
    ): Promise<PumpfunCalloutsResult> =>
      this.request({ method: 'pumpfun.getCallouts', params }, options),
    subscribeCallouts: (
      options: PumpfunSubscriptionOptions,
    ): Promise<Unsubscribe> => this.callouts.subscribeCallouts(options),
  };
  readonly solana = {
    getNativeBalances: (
      params: NativeBalancesOptions,
      options?: RequestOptions,
    ): Promise<NativeBalancesResult> =>
      this.request({ method: 'solana.getNativeBalances', params }, options),
    getTokenBalances: (
      params: TokenBalancesOptions,
      options?: RequestOptions,
    ): Promise<TokenBalancesResult> =>
      this.request({ method: 'solana.getTokenBalances', params }, options),
    subscribeBalance: (
      options: NativeBalanceSubscriptionOptions,
    ): Promise<Unsubscribe> => this.balances.subscribeBalance(options),
    subscribeTokenBalance: (
      options: TokenBalanceSubscriptionOptions,
    ): Promise<Unsubscribe> => this.balances.subscribeTokenBalance(options),
  };

  request(
    input: Extract<DataQuery, { method: 'pumpfun.getCallouts' }>,
    options?: RequestOptions,
  ): Promise<PumpfunCalloutsResult>;
  request(
    input: Extract<DataQuery, { method: 'solana.getNativeBalances' }>,
    options?: RequestOptions,
  ): Promise<NativeBalancesResult>;
  request(
    input: Extract<DataQuery, { method: 'solana.getTokenBalances' }>,
    options?: RequestOptions,
  ): Promise<TokenBalancesResult>;

  request(
    input: Extract<DataQuery, { method: 'ping' }>,
    options?: RequestOptions,
  ): Promise<'pong'>;
  request(
    input: Extract<DataQuery, { method: 'binance.getPrice' }>,
    options?: RequestOptions,
  ): Promise<BinancePriceSnapshot>;
  request(input: DataQuery, options?: RequestOptions): Promise<DataQueryResult>;
  request(
    input: DataQuery,
    options: RequestOptions = {},
  ): Promise<DataQueryResult> {
    const query = prepareQuery(input);
    return this.connection.request(
      query.method,
      query.params,
      query.parse,
      options,
    );
  }

  async batch(
    inputs: DataQuery[],
    options: RequestOptions = {},
  ): Promise<BatchResult<DataQueryResult>[]> {
    if (inputs.length < 1 || inputs.length > 32)
      throw new DataError('invalid_batch', 'Provide 1 to 32 data queries.');
    const queries = inputs.map(prepareQuery);
    // The shared queue coalesces calls into rate-budgeted JSON-RPC frames.
    return Promise.all(
      queries.map(async (query): Promise<BatchResult<DataQueryResult>> => {
        try {
          return {
            status: 'fulfilled',
            value: await this.connection.request(
              query.method,
              query.params,
              query.parse,
              options,
            ),
          };
        } catch (error) {
          return {
            status: 'rejected',
            reason:
              error instanceof DataError
                ? error
                : new DataError('request_error', 'Data query failed.'),
          };
        }
      }),
    );
  }
}

export function createClient(options: DataClientOptions): DataClient {
  return new DataClient(options);
}
