import type {
  BatchResult,
  CreateTokenOptions,
  CreateTokenResult,
  EngineClient,
  EngineHttpClient,
  PumpSwapBuildResult,
  SignatureNotification,
  TransferResult,
  Unsubscribe,
} from '../src/index.js';

export async function publicContracts(
  client: EngineClient,
  http: EngineHttpClient,
): Promise<void> {
  const transfer: TransferResult = await client.solana.transfer({
    sourceAddresses: ['source'],
    destinationAddresses: ['destination'],
    amountLamports: '9007199254740993',
  });
  const created: CreateTokenResult = await client.solana.createToken({
    creator: 'creator',
    platform: 'pump',
    amount: '0.01',
    metadata: {
      name: 'Example',
      symbol: 'EX',
      uri: 'https://example.com/token.json',
    },
  });
  const swapped: PumpSwapBuildResult = await client.solana.pump.swap({
    address: 'wallet',
    mint: 'mint',
    side: 'buy',
    amount: '1000000',
    slippageBps: 100,
  });
  const stop: Unsubscribe = await client.solana.subscribeSignature({
    signature: 'signature',
    signal: new AbortController().signal,
    onUpdate: (result: SignatureNotification) => {
      void result;
    },
  });
  const results: BatchResult<string>[] = await http.batch<string>([
    { method: 'engine.ping' },
  ]);
  const rpcError: string | number | undefined =
    results[0]?.status === 'rejected' ? results[0].reason.code : undefined;
  void [transfer, created, swapped, stop, rpcError];

  http.request({
    // @ts-expect-error Writes require a WebSocket client.
    method: 'solana.broadcastTransaction',
    params: { transactions: [] },
  });
  // @ts-expect-error HTTP clients do not manage subscriptions.
  http.solana.subscribeSignature({ signature: 'signature', onUpdate() {} });
  client.solana.transfer({
    sourceAddresses: [],
    destinationAddresses: [],
    // @ts-expect-error Base-unit amounts must preserve integer precision as strings.
    amountLamports: 1,
  });
  // @ts-expect-error Published metadata cannot also specify an inline image.
  const mixedMetadata: CreateTokenOptions['metadata'] = {
    name: 'Example',
    symbol: 'EX',
    uri: 'https://example.com/token.json',
    image: 'https://example.com/image.png',
  };
  void mixedMetadata;
  // @ts-expect-error Connection snapshots cannot be modified by consumers.
  client.getSnapshot().status = 'connected';
}
