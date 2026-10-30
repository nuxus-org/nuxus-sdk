import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttpClient, EngineError } from '../dist/index.js';
const transportDetail = 'private transport diagnostic';
const url = 'http://localhost:4000';

test('HTTP query uses root POST and no credentials', async () => {
  const client = createHttpClient({
    url,
    fetch: async (address, options) => {
      assert.equal(address, `${url}/`);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, 'error');
      assert.equal(options.credentials, 'omit');
      const call = JSON.parse(options.body);
      assert.equal(call.method, 'engine.ping');
      assert.equal(call.params, undefined);
      return Response.json({
        jsonrpc: '2.0',
        id: call.id,
        result: { serverTimeMs: 123, connectionId: 'http' },
      });
    },
  });
  assert.deepEqual(await client.engine.ping(), {
    serverTimeMs: 123,
    connectionId: 'http',
  });
});

test('HTTP batch matches IDs and preserves partial errors and input order', async () => {
  const client = createHttpClient({
    url,
    fetch: async (_, options) => {
      const calls = JSON.parse(options.body);
      return Response.json([
        {
          jsonrpc: '2.0',
          id: calls[1].id,
          error: {
            code: -32602,
            message: 'Invalid params',
            data: { kind: 'invalid_request' },
          },
        },
        { jsonrpc: '2.0', id: calls[0].id, result: 'pong' },
      ]);
    },
  });
  const result = await client.batch([
    { method: 'engine.ping' },
    { method: 'engine.ping' },
  ]);
  assert.deepEqual(result[0], { status: 'fulfilled', value: 'pong' });
  assert.equal(result[1].reason.code, -32602);
  assert.deepEqual(result[1].reason.data, { kind: 'invalid_request' });
});

test('HTTP rejects subscription/write calls before sending', async () => {
  const client = createHttpClient({
    url,
    fetch: async () => assert.fail('Must not send'),
  });
  for (const method of [
    'solana.subscribeBalance',
    'solana.unsubscribeBalance',
    'solana.getNativeBalances',
    'solana.getTokenBalances',
    'solana.subscribeTokenBalance',
    'solana.unsubscribeTokenBalance',
    'solana.signatureSubscribe',
    'solana.signatureUnsubscribe',
    'solana.getTransfer',
    'solana.pump.getSwap',
    'solana.execute',
    'solana.pump.prepareSwap',
    'solana.pump.swap',
    'solana.jupiter.swap',
    'solana.broadcastTransaction',
    'solana.simulateTransaction',
    'solana.createToken',
    'solana.pump.createToken',
    'solana.raydium.launchlab.createToken',
    'solana.pump.createOffchainToken',
  ]) {
    await assert.rejects(
      client.request({ method }),
      (error) => error.code === 'unsupported_method',
    );
  }
  await assert.rejects(
    client.batch([]),
    (error) => error.code === 'invalid_batch',
  );
});

test('HTTP explicitly permits Pump settings and charity reads', async () => {
  const sent = [];
  const client = createHttpClient({
    url,
    fetch: async (_, options) => {
      const call = JSON.parse(options.body);
      sent.push(call);
      assert.equal(options.credentials, 'omit');
      return Response.json({
        jsonrpc: '2.0',
        id: call.id,
        result: { ok: true },
      });
    },
  });
  for (const method of [
    'solana.pump.getLaunchOptions',
    'solana.pump.getTokenSettings',
    'solana.pump.getCharityConfig',
  ]) {
    const params = { network: 'solana:mainnet-beta' };
    assert.deepEqual(await client.request({ method, params }), { ok: true });
    assert.equal(sent.at(-1).method, method);
    assert.deepEqual(sent.at(-1).params, params);
  }
});

test('HTTP rejects mismatched responses, handles HTTP failure and hides transport secrets', async () => {
  const mismatched = createHttpClient({
    url,
    fetch: async () =>
      Response.json({ jsonrpc: '2.0', id: 'wrong', result: true }),
  });
  await assert.rejects(
    mismatched.engine.ping(),
    (error) => error.code === 'invalid_response',
  );
  const denied = createHttpClient({
    url,
    fetch: async () => new Response(null, { status: 401 }),
  });
  await assert.rejects(
    denied.engine.ping(),
    (error) => error.code === 'http_error' && !error.retryable,
  );
  const failed = createHttpClient({
    url,
    fetch: async () => {
      throw new Error(transportDetail);
    },
  });
  await assert.rejects(
    failed.engine.ping(),
    (error) =>
      error instanceof EngineError && !error.message.includes(transportDetail),
  );
});

test('HTTP cancellation and timeout abort the underlying fetch', async () => {
  const fetch = async (_, options) =>
    new Promise((_, reject) => {
      if (options.signal.aborted) reject(new Error('aborted'));
      else
        options.signal.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
    });
  const client = createHttpClient({ url, fetch, requestTimeoutMs: 20 });
  await assert.rejects(
    client.engine.ping(),
    (error) => error.code === 'request_timeout',
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    client.request({ method: 'engine.ping' }, { signal: abort.signal }),
    (error) => error.code === 'aborted',
  );
});

test(
  'HTTP timeout bounds fetch and body reads that ignore AbortSignal',
  { timeout: 1000 },
  async () => {
    for (const fetch of [
      () => new Promise(() => {}),
      async () => ({ ok: true, json: () => new Promise(() => {}) }),
    ]) {
      const client = createHttpClient({ url, fetch, requestTimeoutMs: 10 });
      await assert.rejects(
        client.engine.ping(),
        (error) =>
          error instanceof EngineError && error.code === 'request_timeout',
      );
    }
  },
);

test(
  'HTTP cancellation interrupts an uncooperative response body',
  { timeout: 1000 },
  async () => {
    const controller = new AbortController();
    const client = createHttpClient({
      url,
      fetch: async () => ({
        ok: true,
        json: () => {
          controller.abort();
          return new Promise(() => {});
        },
      }),
    });
    await assert.rejects(
      client.request({ method: 'engine.ping' }, { signal: controller.signal }),
      { code: 'aborted' },
    );
  },
);

test('pre-aborted HTTP requests never invoke the transport', async () => {
  const client = createHttpClient({
    url,
    fetch: () => assert.fail('Must not fetch'),
  });
  await assert.rejects(
    client.request({ method: 'engine.ping' }, { signal: AbortSignal.abort() }),
    { code: 'aborted' },
  );
});
