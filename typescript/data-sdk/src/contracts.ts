import type {
  PumpfunGetParams,
  PumpfunCalloutsResult,
} from './pumpfun.contracts.js';
import type {
  NativeBalancesOptions,
  TokenBalancesOptions,
  NativeBalancesResult,
  TokenBalancesResult,
} from './solana.contracts.js';
export interface BinancePriceParams {
  stream: string;
}
export interface BinanceUnsubscribeParams {
  subscription: string;
}
export interface BinancePriceSnapshot {
  source: 'binance';
  stream: string;
  symbol: string;
  price: string | null;
  updatedAtMs: number | null;
  receivedAtMs: number | null;
  status: 'waiting' | 'live' | 'stale' | 'unavailable' | 'rejected';
}
export interface BinancePriceNotification {
  jsonrpc: '2.0';
  method: 'binance.priceNotification';
  params: {
    subscription: string;
    sequence: number;
    result: BinancePriceSnapshot;
  };
}
export type BinanceRpcMethods = {
  'binance.getPrice'(params: BinancePriceParams): Promise<BinancePriceSnapshot>;
  'binance.subscribePrice'(params: BinancePriceParams): Promise<string>;
  'binance.unsubscribePrice'(
    params: BinanceUnsubscribeParams,
  ): Promise<boolean>;
};
export type DataQuery =
  | { method: 'pumpfun.getCallouts'; params?: PumpfunGetParams }
  | { method: 'ping'; params?: Record<string, never> | [] }
  | { method: 'binance.getPrice'; params: BinancePriceParams }
  | { method: 'solana.getNativeBalances'; params: NativeBalancesOptions }
  | { method: 'solana.getTokenBalances'; params: TokenBalancesOptions };
export type DataQueryResult =
  | PumpfunCalloutsResult
  | 'pong'
  | BinancePriceSnapshot
  | NativeBalancesResult
  | TokenBalancesResult;
