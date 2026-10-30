import type { BinancePriceSnapshot } from '../src/index.js';
import {
  createClient,
  createHttpClient,
  type Unsubscribe,
} from '../src/index.js';

const client = createClient({
  url: 'ws://localhost:5000/',
  getToken: async () => 'fixture',
});
const http = createHttpClient({
  url: 'http://localhost:5000/',
  getToken: () => 'fixture',
});
const price: Promise<BinancePriceSnapshot> = client.binance.getPrice({
  stream: 'btcusdt@miniTicker',
});
const pong: Promise<'pong'> = http.ping();
const stop: Promise<Unsubscribe> = client.binance.subscribePrice({
  stream: 'btcusdt@miniTicker',
  onUpdate: () => {},
});
void price;
void pong;
void stop;
const native: Promise<import('../src/index.js').NativeBalancesResult> =
  http.solana.getNativeBalances({
    addresses: ['11111111111111111111111111111111'],
  });
void native;
// @ts-expect-error Balance subscriptions require WebSocket.
http.solana.subscribeBalance({
  address: '11111111111111111111111111111111',
  onUpdate: () => {},
});
// @ts-expect-error The worker only supports mainnet and devnet.
client.solana.getNativeBalances({ network: 'solana:testnet', addresses: [] });
// @ts-expect-error Subscriptions are WebSocket-only.
http.binance.subscribePrice({
  stream: 'btcusdt@miniTicker',
  onUpdate: () => {},
});
// @ts-expect-error Authentication is connection-owned, not a raw query method.
client.request({ method: 'authenticate', params: { token: 'fixture' } });

const callouts: Promise<import('../src/index.js').PumpfunCalloutsResult> =
  http.pumpfun.getCallouts({ limit: 20 });
void callouts;
// @ts-expect-error Callout subscriptions require WebSocket.
http.pumpfun.subscribeCallouts({ onUpdate() {} });
