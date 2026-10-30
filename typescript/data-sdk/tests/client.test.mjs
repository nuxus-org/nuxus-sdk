import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, DataError } from '../dist/index.js';
import {
  setup,
  connected,
  authenticate,
  until,
  delay,
  id,
  price,
} from './fixture.mjs';

test('explicit undefined options use defaults and immediate close skips token supplier work', async () => {
  let tokens = 0;
  const client = createClient({
    url: 'ws://localhost:5000/',
    getToken: () => {
      tokens++;
      return 'fixture';
    },
    heartbeatIntervalMs: undefined,
    requestTimeoutMs: undefined,
    requestsPerSecond: undefined,
  });
  client.start();
  client.close();
  await delay(10);
  assert.equal(tokens, 0);
  assert.equal(client.getSnapshot().status, 'stopped');
});

test('abort from a synchronous status listener cancels a connection-waiting query', async (t) => {
  const state = setup(t),
    controller = new AbortController();
  state.client.onStatusChange(() => {
    if (state.client.getSnapshot().status === 'connecting') controller.abort();
  });
  await assert.rejects(state.client.ping({ signal: controller.signal }), {
    code: 'aborted',
  });
});

test('lazy calls share one authenticated socket and validate price results without losing precision', async (t) => {
  const state = setup(t);
  assert.equal(state.sockets.length, 0);
  assert.equal(state.tokens.length, 0);
  const ping = state.client.ping();
  const quote = state.client.binance.getPrice({ stream: 'btcusdt@miniTicker' });
  const socket = await authenticate(state);
  assert.deepEqual(socket.calls[0].params, { token: 'fixture-token-1' });
  assert.equal(state.tokens.length, 1);
  await until(() => socket.calls.length === 3);
  const calls = socket.calls.slice(1);
  socket.receive(
    calls.toReversed().map((call) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: call.method === 'ping' ? 'pong' : price(),
    })),
  );
  assert.equal(await ping, 'pong');
  assert.deepEqual(await quote, price());
  assert.equal(state.client.getSnapshot().connectionVersion, 1);
  assert.ok(Object.isFrozen(state.client.getSnapshot()));
});

test('authentication errors stop retries and never expose JWT contents', async (t) => {
  const state = setup(t);
  const failure = assert.rejects(state.client.ping(), (error) => {
    assert.equal(error.code, -32001);
    assert.equal(error.message, 'Data authentication failed.');
    assert.equal(error.data, undefined);
    return true;
  });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.open();
  socket.error(socket.calls[0], -32001, 'fixture-token-1', {
    token: 'fixture-token-1',
  });
  await failure;
  assert.equal(state.client.getSnapshot().status, 'stopped');
  assert.equal(socket.closed, true);
  await delay(30);
  assert.equal(state.sockets.length, 1);
});

test('close cancels token lookup and ignores its late result', async (t) => {
  let finish, signal;
  const state = setup(t, {
    getToken: (context) => {
      signal = context.signal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const failure = assert.rejects(state.client.ping(), { code: 'closed' });
  await until(() => !!finish);
  state.client.close();
  assert.equal(signal.aborted, true);
  finish('private-fixture-token');
  await failure;
  await delay(10);
  assert.equal(state.sockets.length, 0);
});

test('token supplier failure is sanitized and a later explicit start can recover', async (t) => {
  let fail = true;
  const state = setup(t, {
    getToken: () => {
      if (fail) throw new Error('secret-fixture-token');
      return 'valid-fixture';
    },
  });
  await assert.rejects(
    state.client.ping(),
    (error) =>
      error.code === 'token_error' && !error.message.includes('secret'),
  );
  assert.equal(state.sockets.length, 0);
  fail = false;
  const ping = state.client.ping();
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  socket.reply(socket.calls[1], 'pong');
  assert.equal(await ping, 'pong');
});

test('queries sent before a disconnect reject and are never replayed; reconnect obtains a new token', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const pending = state.client.binance.getPrice({
    stream: 'btcusdt@miniTicker',
  });
  const failed = assert.rejects(pending, { code: 'disconnected' });
  await until(() => socket.calls.length === 2);
  socket.drop();
  await failed;
  const next = await authenticate(state, 1);
  await delay(10);
  assert.equal(next.calls.length, 1);
  assert.equal(next.calls[0].params.token, 'fixture-token-2');
  assert.equal(state.client.getSnapshot().connectionVersion, 2);
});

test('subscriptions map ACKs before immediate snapshots, restore on reconnect, and filter stale sequences/IDs', async (t) => {
  const state = setup(t),
    updates = [],
    subscribed = [];
  const promise = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: (value) => updates.push(value),
    onSubscribed: (value) => subscribed.push(value),
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  assert.deepEqual(socket.calls[1].params, { stream: 'btcusdt@miniTicker' });
  socket.reply(socket.calls[1], id(1));
  socket.event(
    id(1),
    0,
    price(undefined, {
      price: null,
      updatedAtMs: null,
      receivedAtMs: null,
      status: 'waiting',
    }),
  );
  const unsubscribe = await promise;
  socket.event(id(1), 1, price());
  socket.event(id(1), 1, price(undefined, { price: '1' }));
  socket.event(id(1), 0, price(undefined, { price: '2' }));
  assert.equal(updates.length, 2);
  socket.drop();
  const next = await authenticate(state, 1);
  await until(() => next.calls.length === 2);
  next.reply(next.calls[1], id(2));
  next.event(id(1), 2, price(undefined, { price: '3' }));
  next.event(id(2), 0, price(undefined, { price: '4' }));
  assert.deepEqual(subscribed, [id(1), id(2)]);
  assert.equal(updates.at(-1).price, '4');
  assert.equal(updates.length, 3);
  unsubscribe();
  unsubscribe();
  await until(() => next.calls.length === 3);
  assert.deepEqual(next.calls[2].params, { subscription: id(2) });
  next.reply(next.calls[2], true);
  next.event(id(2), 1, price());
  assert.equal(updates.length, 3);
});

test('abort before ACK rejects setup and unsubscribes a late server ID', async (t) => {
  const state = setup(t),
    controller = new AbortController(),
    updates = [];
  const pending = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    signal: controller.signal,
    onUpdate: (value) => updates.push(value),
  });
  const rejected = assert.rejects(pending, { code: 'aborted' });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  controller.abort();
  await rejected;
  socket.reply(socket.calls[1], id(1));
  socket.event(id(1), 0, price());
  await until(() => socket.calls.length === 3);
  assert.equal(socket.calls[2].method, 'binance.unsubscribePrice');
  socket.reply(socket.calls[2], true);
  assert.deepEqual(updates, []);
});

test('unsubscribe while disconnected prevents restoration', async (t) => {
  const state = setup(t);
  const pending = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: () => {},
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  socket.reply(socket.calls[1], id(1));
  const unsubscribe = await pending;
  socket.drop();
  unsubscribe();
  const next = await authenticate(state, 1);
  await delay(10);
  assert.equal(next.calls.length, 1);
});

test('server-rejected subscriptions report onError and do not return after reconnect', async (t) => {
  const state = setup(t),
    errors = [];
  const pending = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: () => {},
    onError: (error) => errors.push(error),
  });
  const rejected = assert.rejects(pending, { code: -32010 });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  socket.error(socket.calls[1], -32010);
  await rejected;
  assert.equal(errors.length, 1);
  socket.drop();
  const next = await authenticate(state, 1);
  await delay(10);
  assert.equal(next.calls.length, 1);
});

test('callback exceptions do not affect another subscription', async (t) => {
  const state = setup(t),
    updates = [];
  const a = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: () => {
      throw new Error('consumer');
    },
  });
  const b = state.client.binance.subscribePrice({
    stream: 'ethusdt@miniTicker',
    onUpdate: (value) => updates.push(value),
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 3);
  socket.reply(socket.calls[1], id(1));
  socket.reply(socket.calls[2], id(2));
  await Promise.all([a, b]);
  socket.event(id(1), 0, price());
  socket.event(id(2), 0, price('ethusdt@miniTicker'));
  assert.equal(updates.length, 1);
  assert.equal(state.client.getSnapshot().status, 'connected');
});

test('logical batches preserve partial failures and input order', async (t) => {
  const state = setup(t),
    socket = await connected(state);
  const pending = state.client.batch([
    { method: 'ping' },
    { method: 'binance.getPrice', params: { stream: 'btcusdt@miniTicker' } },
  ]);
  await until(() => socket.calls.length === 3);
  socket.receive([
    {
      jsonrpc: '2.0',
      id: socket.calls[2].id,
      error: { code: -32010, message: 'Unavailable' },
    },
    { jsonrpc: '2.0', id: socket.calls[1].id, result: 'pong' },
  ]);
  const result = await pending;
  assert.deepEqual(result[0], { status: 'fulfilled', value: 'pong' });
  assert.equal(result[1].reason.code, -32010);
  await assert.rejects(state.client.batch([]), { code: 'invalid_batch' });
  await assert.rejects(state.client.batch(Array(33).fill({ method: 'ping' })), {
    code: 'invalid_batch',
  });
});

test(
  'rate budget counts authenticate and each batched entry',
  { timeout: 6000 },
  async (t) => {
    const state = setup(t, { requestsPerSecond: 3, requestTimeoutMs: 5000 });
    const socket = await connected(state);
    socket.onSend = (frame) =>
      socket.receive(
        [frame]
          .flat()
          .map((call) => ({ jsonrpc: '2.0', id: call.id, result: 'pong' })),
      );
    const replies = await state.client.batch(
      Array.from({ length: 7 }, () => ({ method: 'ping' })),
    );
    assert.equal(
      replies.filter((reply) => reply.status === 'fulfilled').length,
      7,
    );
    for (let i = 3; i < socket.times.length; i++)
      assert.ok(socket.times[i].at - socket.times[i - 3].at >= 1000);
    assert.ok(
      socket.frames.every(
        (frame) => !Array.isArray(frame) || frame.length <= 3,
      ),
    );
  },
);

test('unknown subscription outcomes trigger connection recovery rather than leaking resources', async (t) => {
  const state = setup(t, { requestTimeoutMs: 40 });
  const pending = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: () => {},
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  await until(() => socket.closed);
  const next = await authenticate(state, 1);
  await until(() => next.calls.length === 2);
  next.reply(next.calls[1], id(2));
  assert.equal(typeof (await pending), 'function');
});

test('malformed/mismatched price notifications never reach application callbacks', async (t) => {
  const state = setup(t),
    updates = [];
  const pending = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: (value) => updates.push(value),
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  socket.reply(socket.calls[1], id(1));
  await pending;
  socket.event(id(1), 0, price('ethusdt@miniTicker'));
  assert.equal(state.client.getSnapshot().error.code, 'invalid_response');
  assert.deepEqual(updates, []);
});

test('closing from a status listener prevents late socket creation', async (t) => {
  const state = setup(t);
  state.client.onStatusChange(() => {
    if (state.client.getSnapshot().status === 'connecting')
      state.client.close();
  });
  await assert.rejects(state.client.ping(), { code: 'closed' });
  await delay(10);
  assert.equal(state.tokens.length, 0);
  assert.equal(state.sockets.length, 0);
});

test('limits and invalid streams are rejected before unnecessary IO', async (t) => {
  const state = setup(t);
  assert.throws(
    () => state.client.binance.getPrice({ stream: 'SOL@miniTicker' }),
    { code: 'invalid_params' },
  );
  assert.throws(
    () =>
      state.client.request({
        method: 'authenticate',
        params: { token: 'fixture' },
      }),
    { code: 'unsupported_method' },
  );
  const pending = Array.from({ length: 100 }, (_, i) =>
    state.client.binance.subscribePrice({
      stream: `s${i}@miniTicker`,
      onUpdate: () => {},
    }),
  );
  const settled = Promise.allSettled(pending);
  await assert.rejects(
    state.client.binance.subscribePrice({
      stream: 's0@miniTicker',
      onUpdate: () => {},
    }),
    { code: 'duplicate_subscription' },
  );
  await assert.rejects(
    state.client.binance.subscribePrice({
      stream: 'overflow@miniTicker',
      onUpdate: () => {},
    }),
    { code: 'subscription_limit' },
  );
  state.client.close();
  assert.equal((await settled).length, 100);
  for (const url of [
    'https://example.com/',
    'ws://user:secret@example.com/',
    'ws://example.com/?token=secret',
  ])
    assert.throws(
      () => createClient({ url, getToken: () => 'fixture' }),
      DataError,
    );
});

test('request cancellation and read timeout leave a connected socket reusable', async (t) => {
  const state = setup(t, { requestTimeoutMs: 40 });
  const socket = await connected(state);
  const controller = new AbortController();
  const pending = state.client.ping({ signal: controller.signal });
  const rejected = assert.rejects(pending, { code: 'aborted' });
  await until(() => socket.calls.length === 2);
  controller.abort();
  await rejected;
  socket.reply(socket.calls[1], 'pong');
  await assert.rejects(state.client.ping(), { code: 'request_timeout' });
  assert.equal(state.client.getSnapshot().status, 'connected');
  const next = state.client.ping();
  await until(() => socket.calls.length === 4);
  socket.reply(socket.calls[3], 'pong');
  assert.equal(await next, 'pong');
});

test('transient authentication failure retries with another token', async (t) => {
  const state = setup(t);
  const pending = state.client.ping();
  await until(() => state.sockets.length === 1);
  state.sockets[0].open();
  state.sockets[0].error(state.sockets[0].calls[0], -32002);
  const socket = await authenticate(state, 1);
  await until(() => socket.calls.length === 2);
  socket.reply(socket.calls[1], 'pong');
  assert.equal(await pending, 'pong');
  assert.equal(state.tokens.length, 2);
});

test('missed heartbeat reconnects and reauthenticates', async (t) => {
  const state = setup(t, { heartbeatIntervalMs: 15, requestTimeoutMs: 20 });
  const socket = await connected(state);
  await until(() => socket.calls.some((call) => call.method === 'ping'));
  await until(() => socket.closed && state.sockets.length === 2);
  assert.equal(state.tokens.length, 2);
});

test('uncertain unsubscribe reconnects to clean remote state while restoring other subscriptions', async (t) => {
  const state = setup(t);
  const a = state.client.binance.subscribePrice({
    stream: 'btcusdt@miniTicker',
    onUpdate: () => {},
  });
  const b = state.client.binance.subscribePrice({
    stream: 'ethusdt@miniTicker',
    onUpdate: () => {},
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 3);
  socket.reply(socket.calls[1], id(1));
  socket.reply(socket.calls[2], id(2));
  const [stop] = await Promise.all([a, b]);
  stop();
  await until(() => socket.calls.length === 4);
  socket.error(socket.calls[3], -32003);
  const next = await authenticate(state, 1);
  await until(() => next.calls.length === 2);
  assert.deepEqual(next.calls[1].params, { stream: 'ethusdt@miniTicker' });
  next.reply(next.calls[1], id(3));
});
