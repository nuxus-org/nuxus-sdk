import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createClient as createEngineClient,
  createHttpClient as createEngineHttpClient,
} from '@nuxus/engine-sdk';
import {
  createClient as createDataClient,
  createHttpClient as createDataHttpClient,
} from '@nuxus/data-sdk';

const price = {
  source: 'binance',
  stream: 'solusdt@miniTicker',
  symbol: 'SOLUSDT',
  price: '18446744073709551615.000000001',
  updatedAtMs: 1800000000000,
  receivedAtMs: 1800000000001,
  status: 'live',
};

function socket(respond) {
  return {
    readyState: 1,
    onopen: null,
    onmessage: null,
    onerror: null,
    onclose: null,
    receive(messages) {
      this.onmessage?.({ data: JSON.stringify(messages) });
    },
    send(text) {
      for (const call of [JSON.parse(text)].flat()) {
        const { result, notifications = [] } = respond(call);
        queueMicrotask(() =>
          this.receive([
            { jsonrpc: '2.0', id: call.id, result },
            ...notifications,
          ]),
        );
      }
    },
    close() {
      this.readyState = 3;
    },
  };
}

test('packed exports resolve compiled modules with the development condition enabled', () => {
  assert.match(import.meta.resolve('@nuxus/engine-sdk'), /\/dist\/index\.js$/);
  assert.match(import.meta.resolve('@nuxus/data-sdk'), /\/dist\/index\.js$/);
  for (const value of [
    globalThis.WebSocket,
    globalThis.fetch,
    globalThis.structuredClone,
  ])
    assert.equal(typeof value, 'function');
});

test(
  'engine WebSocket handshake and transaction binding preserve exact amounts',
  { timeout: 5000 },
  async (t) => {
    const transport = socket((call) => {
      if (call.method === 'engine.ping')
        return { result: { connectionId: 'consumer', serverTimeMs: 123 } };
      assert.equal(call.method, 'solana.transfer');
      assert.equal(call.params.amountLamports, '9007199254740993');
      return {
        result: {
          status: 'prepared',
          amountLamports: call.params.amountLamports,
          transactions: [],
        },
      };
    });
    const client = createEngineClient({
      url: 'wss://example.invalid/ws',
      heartbeatIntervalMs: 0,
      createWebSocket: (_, protocols) => {
        assert.deepEqual(protocols, ['nuxus.v2']);
        queueMicrotask(() =>
          transport.receive({
            jsonrpc: '2.0',
            method: 'engine.connected',
            params: { connectionId: 'consumer' },
          }),
        );
        return transport;
      },
    });
    t.after(() => client.close());
    assert.equal((await client.engine.ping()).connectionId, 'consumer');
    const result = await client.solana.transfer({
      sourceAddresses: ['source'],
      destinationAddresses: ['destination'],
      amountLamports: '9007199254740993',
    });
    assert.equal(result.amountLamports, '9007199254740993');
  },
);

test('engine HTTP queries retain the write-method boundary', async () => {
  let calls = 0;
  const client = createEngineHttpClient({
    url: 'https://example.invalid/',
    fetch: async (_, options) => {
      calls++;
      const call = JSON.parse(options.body);
      assert.equal(options.credentials, 'omit');
      return Response.json({
        jsonrpc: '2.0',
        id: call.id,
        result: { connectionId: 'http', serverTimeMs: 456 },
      });
    },
  });
  assert.equal((await client.engine.ping()).serverTimeMs, 456);
  await assert.rejects(
    client.request({ method: 'solana.broadcastTransaction' }),
    { code: 'unsupported_method' },
  );
  assert.equal(calls, 1);
});

test(
  'data WebSocket authentication and subscription delivery work from packed modules',
  { timeout: 5000 },
  async (t) => {
    const methods = [];
    const subscription = '00000000-0000-4000-8000-000000000001';
    const transport = socket((call) => {
      methods.push(call.method);
      if (call.method === 'authenticate') {
        assert.equal(call.params.token, 'fixture-token');
        return { result: true };
      }
      if (call.method === 'binance.getPrice') return { result: price };
      if (call.method === 'binance.subscribePrice')
        return {
          result: subscription,
          notifications: [
            {
              jsonrpc: '2.0',
              method: 'binance.priceNotification',
              params: { subscription, sequence: 1, result: price },
            },
          ],
        };
      assert.equal(call.method, 'binance.unsubscribePrice');
      return { result: true };
    });
    const client = createDataClient({
      url: 'wss://example.invalid/',
      getToken: () => 'fixture-token',
      heartbeatIntervalMs: 0,
      createWebSocket: () => {
        queueMicrotask(() => transport.onopen?.({}));
        return transport;
      },
    });
    t.after(() => client.close());
    assert.equal(
      (await client.binance.getPrice({ stream: price.stream })).price,
      price.price,
    );
    assert.deepEqual(methods, ['authenticate', 'binance.getPrice']);
    const updates = [];
    const stop = await client.binance.subscribePrice({
      stream: price.stream,
      onUpdate: (value) => updates.push(value),
    });
    assert.equal(updates[0].price, price.price);
    stop();
  },
);

test('data HTTP authenticates and preserves decimal strings', async () => {
  const client = createDataHttpClient({
    url: 'https://example.invalid/',
    getToken: () => 'fixture-token',
    fetch: async (_, options) => {
      const call = JSON.parse(options.body);
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      assert.equal(options.credentials, 'omit');
      return Response.json({ jsonrpc: '2.0', id: call.id, result: price });
    },
  });
  assert.equal(
    (await client.binance.getPrice({ stream: price.stream })).price,
    price.price,
  );
});
