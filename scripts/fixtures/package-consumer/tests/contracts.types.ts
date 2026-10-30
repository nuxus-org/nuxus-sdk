import type {
  EngineClient,
  EngineHttpClient,
  TransferResult,
  CreateTokenResult,
} from '@nuxus/engine-sdk';
import type {
  DataClient,
  DataHttpClient,
  BinancePriceSnapshot,
  NativeBalancesResult,
} from '@nuxus/data-sdk';

export function publicContracts(
  engine: EngineClient,
  engineHttp: EngineHttpClient,
  data: DataClient,
  dataHttp: DataHttpClient,
): void {
  const transfer: Promise<TransferResult> = engine.solana.transfer({
    sourceAddresses: ['source'],
    destinationAddresses: ['destination'],
    amountLamports: '9007199254740993',
  });
  const token: Promise<CreateTokenResult> = engine.solana.pump.createToken({
    creator: 'creator',
    metadata: {
      name: 'Example',
      symbol: 'EX',
      uri: 'https://example.invalid/token.json',
    },
  });
  const price: Promise<BinancePriceSnapshot> = data.binance.getPrice({
    stream: 'solusdt@miniTicker',
  });
  const balances: Promise<NativeBalancesResult> =
    dataHttp.solana.getNativeBalances({
      addresses: ['wallet'],
      network: 'solana:devnet',
    });
  void [transfer, token, price, balances];
  // @ts-expect-error HTTP engine clients reject transaction writes.
  engineHttp.request({ method: 'solana.broadcastTransaction' });
  // @ts-expect-error Data subscriptions require a WebSocket client.
  dataHttp.binance.subscribePrice({
    stream: 'solusdt@miniTicker',
    onUpdate() {},
  });
}
