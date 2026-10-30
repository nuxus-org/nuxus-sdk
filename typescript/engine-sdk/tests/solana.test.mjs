import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '../dist/index.js';
import { delay, until, setup, connected } from './fixture.mjs';

test('explicit unsigned simulation returns execution failures and diagnostics without broadcasting', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const pending = state.client.solana.simulateTransaction({
    network: 'solana:mainnet-beta',
    transaction: 'unsigned-v1-base64',
    minContextSlot: 99,
  });
  await until(() => socket.sent.length === 1);
  assert.deepEqual(socket.sent[0].params, {
    network: 'solana:mainnet-beta',
    transaction: 'unsigned-v1-base64',
    minContextSlot: 99,
  });
  assert.equal(socket.sent[0].method, 'solana.simulateTransaction');
  const result = {
    context: { slot: 100 },
    value: {
      err: { InstructionError: [0, { Custom: 6001 }] },
      logs: ['Program log: failed'],
      unitsConsumed: 123,
      returnData: null,
    },
  };
  socket.reply(socket.sent[0], result);
  assert.deepEqual(await pending, result);
  assert.equal(socket.sent.length, 1);
});

test('signed broadcast preserves the list and is never replayed on reconnect', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const params = {
    transactions: ['signed-a', 'signed-b'],
    network: 'solana:devnet',
  };
  const request = state.client.solana.broadcastTransaction(params);
  const rejected = assert.rejects(
    request,
    (error) => error.code === 'disconnected',
  );
  await until(() => socket.sent.length === 1);
  assert.equal(socket.sent[0].method, 'solana.broadcastTransaction');
  assert.deepEqual(socket.sent[0].params, params);
  socket.drop();
  await rejected;
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  await until(() => state.client.getSnapshot().status === 'connected');
  assert.equal(state.sockets[1].sent.length, 0);
});

for (const protocol of [
  'pump',
  'jupiter',
  'meteora-dbc',
  'meteora-dlmm',
  'meteora-damm-v2',
  'meteora-damm-v1',
  'raydium-launchlab',
  'raydium-cpmm',
  'pump-amm',
])
  test(`${protocol} unsigned build sends public addresses and never replays after disconnect`, async (t) => {
    const state = setup(t);
    const socket = await connected(state);
    const params = {
      address: 'wallet-public-address',
      mint: 'mint',
      side: 'buy',
      amount: '1000000',
      slippageBps: 500,
      ...(!['pump', 'jupiter'].includes(protocol)
        ? { pool: 'pool-address' }
        : {}),
    };
    assert.equal(state.client.solana.pump.prepareSwap, undefined);
    const sending =
      protocol === 'jupiter'
        ? state.client.solana.jupiter.swap(params)
        : protocol === 'pump'
          ? state.client.solana.pump.swap(params)
          : protocol === 'meteora-dlmm'
            ? state.client.solana.meteora.dlmm.swap(params)
            : protocol === 'meteora-dbc'
              ? state.client.solana.meteora.dbc.swap(params)
              : protocol === 'meteora-damm-v2'
                ? state.client.solana.meteora.dammV2.swap(params)
                : protocol === 'meteora-damm-v1'
                  ? state.client.solana.meteora.dammV1.swap(params)
                  : protocol === 'pump-amm'
                    ? state.client.solana.pump.amm.swap(params)
                    : protocol === 'raydium-cpmm'
                      ? state.client.solana.raydium.cpmm.swap(params)
                      : state.client.solana.raydium.launchlab.swap(params);
    const rejected = assert.rejects(sending, (e) => e.code === 'disconnected');
    await until(() => socket.sent.length === 1);
    assert.equal(
      socket.sent[0].method,
      protocol === 'jupiter'
        ? 'solana.jupiter.swap'
        : protocol === 'pump'
          ? 'solana.pump.swap'
          : protocol === 'meteora-dlmm'
            ? 'solana.meteora.dlmm.swap'
            : protocol === 'meteora-dbc'
              ? 'solana.meteora.dbc.swap'
              : protocol === 'meteora-damm-v2'
                ? 'solana.meteora.dammV2.swap'
                : protocol === 'meteora-damm-v1'
                  ? 'solana.meteora.dammV1.swap'
                  : protocol === 'pump-amm'
                    ? 'solana.pump.amm.swap'
                    : protocol === 'raydium-cpmm'
                      ? 'solana.raydium.cpmm.swap'
                      : 'solana.raydium.launchlab.swap',
    );
    assert.deepEqual(socket.sent[0].params, params);
    socket.drop();
    await rejected;
    await until(() => state.sockets.length === 2);
    state.sockets[1].connect();
    const outcomes = [];
    const watching = state.client.solana.subscribeSignature({
      signature: 'signature',
      onUpdate: (value) => outcomes.push(value),
    });
    await until(() => state.sockets[1].sent.length === 1);
    const watch = state.sockets[1].sent[0];
    assert.equal(watch.method, 'solana.signatureSubscribe');
    state.sockets[1].reply(watch, 'watch');
    await watching;
    state.sockets[1].event(
      'watch',
      1,
      { signature: 'signature', status: 'processed' },
      'solana.signatureNotification',
    );
    assert.equal(outcomes[0].status, 'processed');
  });

test('typed transfers return unsigned bytes and broadcast is never replayed on reconnect', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const options = {
    network: 'solana:devnet',
    sourceAddresses: ['a', 'b'],
    destinationAddresses: ['c'],
    amountLamports: '70000000',
  };
  const pending = state.client.solana.transfer(options);
  await until(() => socket.sent.length === 1);
  assert.equal(socket.sent[0].method, 'solana.transfer');
  assert.deepEqual(socket.sent[0].params, options);
  socket.reply(socket.sent[0], {
    status: 'prepared',
    transactionVersion: 1,
    transactions: [{ unsignedTransaction: 'unsigned-base64' }],
  });
  const preview = await pending;
  assert.equal(preview.transactionVersion, 1);
  assert.equal(preview.transactions[0].unsignedTransaction, 'unsigned-base64');
  const execute = state.client.solana.broadcastTransaction({
    network: 'solana:devnet',
    transactions: ['client-signed-base64'],
  });
  const rejected = assert.rejects(execute);
  await until(() => socket.sent.length === 2);
  socket.drop();
  await rejected;
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  assert.equal(state.sockets[1].sent.length, 0);
  const outcomes = [];
  const watching = state.client.solana.subscribeSignature({
    network: 'solana:devnet',
    signature: 'known-before-broadcast',
    onUpdate: (value) => outcomes.push(value),
  });
  await until(() => state.sockets[1].sent.length === 1);
  const watch = state.sockets[1].sent[0];
  assert.equal(watch.method, 'solana.signatureSubscribe');
  assert.equal(watch.params.signature, 'known-before-broadcast');
  state.sockets[1].reply(watch, 'watch');
  await watching;
  state.sockets[1].event(
    'watch',
    1,
    { status: 'processed' },
    'solana.signatureNotification',
  );
  assert.equal(outcomes[0].status, 'processed');
});

for (const method of ['solana.createToken', 'solana.pump.createToken']) {
  for (const imageField of ['image', 'image_url']) {
    test(`${method} forwards inline metadata with ${imageField} without a browser upload or broadcast`, async (t) => {
      const state = setup(t);
      const socket = await connected(state);
      const metadata = {
        name: 'Nuxus',
        symbol: 'NUX',
        [imageField]: 'data:image/png;base64,iVBORw0KGgo=',
        website: 'https://nuxus.io',
        description: 'Example',
      };
      const options = {
        creator: 'creator',
        metadata,
        ...(method === 'solana.createToken' ? { platform: 'pump' } : {}),
      };
      const create =
        method === 'solana.createToken'
          ? state.client.solana.createToken
          : state.client.solana.pump.createToken;
      const pending = create(options);
      await until(() => socket.sent.length === 1);
      assert.deepEqual(socket.sent[0].params.metadata, metadata);
      socket.reply(socket.sent[0], {
        metadataUri: 'https://metadata.nuxus.io/metadata/test.json',
      });
      assert.equal(
        (await pending).metadataUri,
        'https://metadata.nuxus.io/metadata/test.json',
      );
      assert.equal(socket.sent.length, 1);
    });
  }
  test(`${method} serializes published metadata without broadcasting or replaying`, async (t) => {
    const state = setup(t);
    const socket = await connected(state);
    const options = {
      creator: 'creator',
      platform: 'pump',
      amount: 0.0001,
      metadata: {
        name: 'Nuxus',
        symbol: 'NUX',
        uri: 'https://metadata.nuxus.io/test.json',
      },
      fees: { bribe: 0.001, priority: '0.001' },
      bundles: null,
      mint: 'mint-keypair',
    };
    const create =
      method === 'solana.createToken'
        ? state.client.solana.createToken
        : state.client.solana.pump.createToken;
    if (method === 'solana.pump.createToken') delete options.platform;
    const pending = create(options);
    await until(() => socket.sent.length === 1);
    assert.equal(socket.sent[0].method, method);
    assert.equal(socket.sent[0].params.platform, options.platform);
    assert.equal(
      socket.sent[0].params.metadata.uri,
      'https://metadata.nuxus.io/test.json',
    );
    assert.equal(socket.sent[0].params.amount, 0.0001);
    assert.deepEqual(socket.sent[0].params.fees, options.fees);
    assert.equal(socket.sent[0].params.metadata.image, undefined);
    const result = {
      platform: 'pump',
      mint: 'mint',
      metadataUri: 'https://metadata.nuxus.io/test.json',
      transactions: [
        {
          unsignedTransaction: 'wire',
          additionalSignatures: [{ address: 'mint', signature: 'signature' }],
        },
      ],
    };
    socket.reply(socket.sent[0], result);
    assert.deepEqual(await pending, result);
    assert.equal(socket.sent.length, 1);
    const second = create({
      ...options,
      metadata: {
        name: 'Nuxus',
        symbol: 'NUX',
        uri: 'https://metadata.nuxus.io/test.json',
      },
    });
    const rejected = assert.rejects(second, { code: 'disconnected' });
    await until(() => socket.sent.length === 2);
    socket.drop();
    await rejected;
    await until(() => state.sockets.length === 2);
    state.sockets[1].connect();
    await delay(20);
    assert.equal(state.sockets[1].sent.length, 0);
  });
}

for (const platform of ['bonk', 'stonk']) {
  for (const direct of [false, true]) {
    test(`${platform} standard create uses the ${direct ? 'LaunchLab' : 'generic'} builder without altering metadata or broadcasting`, async (t) => {
      const state = setup(t);
      const socket = await connected(state);
      const options = {
        platform,
        creator: 'creator',
        amount: '0.001',
        quoteMint: 'So11111111111111111111111111111111111111112',
        metadata: {
          name: 'Nuxus',
          symbol: 'NUX',
          image: 'https://example.com/logo.png',
          description: 'External custom description',
        },
        bundles: null,
      };
      const create = direct
        ? state.client.solana.raydium.launchlab.createToken
        : state.client.solana.createToken;
      const pending = create(options);
      await until(() => socket.sent.length === 1);
      assert.equal(
        socket.sent[0].method,
        direct ? 'solana.raydium.launchlab.createToken' : 'solana.createToken',
      );
      assert.deepEqual(socket.sent[0].params, options);
      socket.reply(socket.sent[0], {
        platform,
        metadataUri: 'https://metadata.nuxus.io/test.json',
      });
      assert.equal((await pending).platform, platform);
      assert.equal(socket.sent.length, 1);
    });
  }
}

test('balance query and subscription helpers have moved entirely to data-sdk', () => {
  const ws = createClient({ url: 'ws://localhost:4000/ws' });
  for (const method of [
    'getNativeBalances',
    'getTokenBalances',
    'subscribeBalance',
    'subscribeTokenBalance',
  ])
    assert.equal(method in ws.solana, false);
  assert.equal(typeof ws.solana.subscribeSignature, 'function');
  ws.close();
});

test('Pump extension methods preserve configuration and keep offchain registration separate from transaction builds', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const pump = {
    quoteMint: 'quote',
    creatorFeeBps: 125,
    holderRewards: false,
    mayhem: false,
    feeRecipients: [{ type: 'wallet', address: 'recipient', shareBps: 10000 }],
  };
  const pending = state.client.solana.pump.createToken({
    creator: 'creator',
    amount: '0',
    metadata: {
      name: 'Name',
      symbol: 'SYM',
      uri: 'https://example.com/meta.json',
    },
    pump,
  });
  await until(() =>
    socket.sent.some((r) => r.method === 'solana.pump.createToken'),
  );
  const request = socket.sent.find(
    (r) => r.method === 'solana.pump.createToken',
  );
  assert.deepEqual(request.params.pump, pump);
  socket.reply(request, { mint: 'mint' });
  await pending;
  const offchain = state.client.solana.pump.createOffchainToken({
    creator: 'creator',
    metadata: {
      name: 'Name',
      symbol: 'SYM',
      image: 'https://example.com/image.png',
    },
    auth: { timestamp: 123, signature: 'proof' },
  });
  await until(() =>
    socket.sent.some((r) => r.method === 'solana.pump.createOffchainToken'),
  );
  const registered = socket.sent.find(
    (r) => r.method === 'solana.pump.createOffchainToken',
  );
  assert.deepEqual(registered.params.auth, {
    timestamp: 123,
    signature: 'proof',
  });
  socket.reply(registered, {
    status: 'offchain',
    mint: 'mint',
    url: 'https://pump.fun/coin/mint',
  });
  assert.equal((await offchain).status, 'offchain');
  assert.equal(
    socket.sent.some((r) => r.method === 'solana.broadcastTransaction'),
    false,
  );
});
