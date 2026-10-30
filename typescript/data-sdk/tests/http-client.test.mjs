import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpClient } from '../dist/index.js';
import { price } from './fixture.mjs';

test('HTTP uses a fresh supplier call, Bearer auth, no cookies/redirects, and exact price strings', async () => {
  let tokens = 0;
  const client = createHttpClient({
    url: 'https://data.example/',
    getToken: () => `fixture-${++tokens}`,
    fetch: async (url, options) => {
      assert.equal(url, 'https://data.example/');
      assert.equal(options.headers.Authorization, `Bearer fixture-${tokens}`);
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      const request = JSON.parse(options.body);
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: request.method === 'ping' ? 'pong' : price(),
      });
    },
  });
  assert.deepEqual(
    await client.binance.getPrice({ stream: 'btcusdt@miniTicker' }),
    price(),
  );
  assert.equal(await client.ping(), 'pong');
  assert.equal(tokens, 2);
});

test('HTTP batches correlate replies and keep per-query RPC errors', async () => {
  const client = createHttpClient({
    url: 'https://data.example/',
    getToken: () => 'fixture',
    fetch: async (_url, options) => {
      const [a, b] = JSON.parse(options.body);
      return Response.json([
        {
          jsonrpc: '2.0',
          id: b.id,
          error: { code: -32003, message: 'Rate limit exceeded' },
        },
        { jsonrpc: '2.0', id: a.id, result: 'pong' },
      ]);
    },
  });
  const results = await client.batch([
    { method: 'ping' },
    { method: 'binance.getPrice', params: { stream: 'btcusdt@miniTicker' } },
  ]);
  assert.deepEqual(results[0], { status: 'fulfilled', value: 'pong' });
  assert.equal(results[1].reason.code, -32003);
  await assert.rejects(client.batch([]), { code: 'invalid_batch' });
});

test('HTTP rejects raw authentication/subscriptions before retrieving a token', async () => {
  let tokens = 0;
  const client = createHttpClient({
    url: 'https://data.example/',
    getToken: () => {
      tokens++;
      return 'fixture';
    },
  });
  for (const method of [
    'authenticate',
    'binance.subscribePrice',
    'binance.unsubscribePrice',
  ])
    await assert.rejects(client.request({ method }), {
      code: 'unsupported_method',
    });
  assert.equal(tokens, 0);
});

test('HTTP authentication failures are sanitized and never retried', async () => {
  let requests = 0;
  const client = createHttpClient({
    url: 'https://data.example/',
    getToken: () => 'private-fixture',
    fetch: async () => {
      requests++;
      return Response.json({ token: 'private-fixture' }, { status: 401 });
    },
  });
  await assert.rejects(
    client.ping(),
    (error) =>
      error.code === 'unauthorized' &&
      !error.message.includes('private-fixture'),
  );
  assert.equal(requests, 1);
});

test('HTTP validates response IDs, result envelopes and domain payloads', async () => {
  let response = 'wrong-id';
  const client = createHttpClient({
    url: 'https://data.example/',
    getToken: () => 'fixture',
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (response === 'wrong-id')
        return Response.json({ jsonrpc: '2.0', id: 'wrong', result: 'pong' });
      if (response === 'duplicate')
        return Response.json(
          [request, request].map((call) => ({
            jsonrpc: '2.0',
            id: call[0].id,
            result: 'pong',
          })),
        );
      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: price(undefined, { price: 123 }),
      });
    },
  });
  await assert.rejects(client.ping(), { code: 'invalid_response' });
  response = 'numeric-price';
  await assert.rejects(
    client.binance.getPrice({ stream: 'btcusdt@miniTicker' }),
    { code: 'invalid_response' },
  );
  response = 'duplicate';
  await assert.rejects(client.batch([{ method: 'ping' }, { method: 'ping' }]), {
    code: 'invalid_response',
  });
});

test('HTTP cancellation and timeout include token lookup even if supplier ignores its signal', async () => {
  let calls = 0;
  const client = createHttpClient({
    url: 'https://data.example/',
    requestTimeoutMs: 20,
    getToken: () => {
      calls++;
      return new Promise(() => {});
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.ping({ signal: controller.signal }), {
    code: 'aborted',
  });
  assert.equal(calls, 0);
  await assert.rejects(client.ping(), { code: 'request_timeout' });
  const next = new AbortController();
  const pending = client.ping({ signal: next.signal });
  next.abort();
  await assert.rejects(pending, { code: 'aborted' });
});

test('HTTP aborts an in-flight fetch and hides supplier/transport exception details', async () => {
  let captured;
  const client = createHttpClient({
    url: 'https://data.example/',
    requestTimeoutMs: 20,
    getToken: () => 'fixture',
    fetch: (_url, options) => {
      captured = options.signal;
      return new Promise(() => {});
    },
  });
  await assert.rejects(client.ping(), { code: 'request_timeout' });
  assert.equal(captured.aborted, true);
  const failing = createHttpClient({
    url: 'https://data.example/',
    getToken: () => {
      throw new Error('private-secret');
    },
  });
  await assert.rejects(
    failing.ping(),
    (error) =>
      error.code === 'token_error' && !error.message.includes('private-secret'),
  );
});
