import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subscribeFixture,
  delay,
  until,
  setup,
  connected,
} from './fixture.mjs';

test('subscription ack maps ID before immediate snapshot; reconnect refreshes snapshots and ignores duplicate/stale events', async (t) => {
  const state = setup(t);
  const updates = [];
  const subscribed = subscribeFixture(state.client, {
    address: 'address',
    onUpdate: (value) => updates.push(value),
  });
  await until(() => state.sockets.length === 1);
  let socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 1);
  assert.deepEqual(socket.sent[0].params, { address: 'address' });
  assert.equal(socket.sent[0].method, 'fixture.subscribe');
  socket.reply(socket.sent[0], 'old');
  socket.event('old', 0, { amount: '1' });
  const unsubscribe = await subscribed;
  assert.deepEqual(updates, [{ amount: '1' }]);
  socket.event('old', 1, { amount: '2' });
  socket.event('old', 1, { amount: '2' });
  assert.equal(updates.length, 2);
  socket.drop();
  await until(() => state.sockets.length === 2);
  socket = state.sockets[1];
  socket.connect();
  await until(() => socket.sent.length === 1);
  socket.reply(socket.sent[0], 'new');
  socket.event('new', 0, { amount: '3' });
  socket.event('old', 2, { amount: 'wrong' });
  assert.equal(updates.length, 3);
  unsubscribe();
  unsubscribe();
  assert.deepEqual(socket.sent[1].params, { subscription: 'new' });
  assert.equal(socket.sent[1].method, 'fixture.unsubscribe');
  socket.reply(socket.sent[1], true);
  socket.drop();
  await until(() => state.sockets.length === 3);
  state.sockets[2].connect();
  await delay(10);
  assert.equal(state.sockets[2].sent.length, 0);
});

test('abort during setup rejects promptly, cleans late server ack and never delivers callbacks', async (t) => {
  const state = setup(t);
  const controller = new AbortController();
  const pending = subscribeFixture(state.client, {
    address: 'address',
    signal: controller.signal,
    onUpdate: () => assert.fail('Cancelled callback'),
  });
  const rejection = assert.rejects(pending, { code: 'aborted' });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 1);
  controller.abort();
  await rejection;
  socket.reply(socket.sent[0], 'late');
  socket.event('late', 0, {});
  assert.deepEqual(socket.sent[1].params, { subscription: 'late' });
  socket.reply(socket.sent[1], true);
});

test('unsubscribe while offline prevents restoration', async (t) => {
  const state = setup(t);
  const promise = subscribeFixture(state.client, {
    address: 'wallet',
    onUpdate: () => {},
  });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 1);
  socket.reply(socket.sent[0], 'balance');
  const unsubscribe = await promise;
  socket.drop();
  unsubscribe();
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  await delay(10);
  assert.equal(state.sockets[1].sent.length, 0);
});

test('rejected initial subscriptions reject Promise, report onError and are removed', async (t) => {
  const state = setup(t);
  const errors = [];
  const pending = subscribeFixture(state.client, {
    address: 'wallet',
    onUpdate: () => {},
    onError: (error) => errors.push(error),
  });
  const rejection = assert.rejects(pending, { code: -32602 });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 1);
  socket.receive({
    jsonrpc: '2.0',
    id: socket.sent[0].id,
    error: { code: -32602, message: 'Rejected' },
  });
  await rejection;
  assert.equal(errors.length, 1);
  socket.drop();
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  await delay(10);
  assert.equal(state.sockets[1].sent.length, 0);
});

test('callback exceptions are isolated from other subscriptions', async (t) => {
  const state = setup(t);
  const values = [];
  const a = subscribeFixture(state.client, {
    address: 'wallet-a',
    onUpdate: () => {
      throw new Error('consumer');
    },
  });
  const b = subscribeFixture(state.client, {
    address: 'wallet-b',
    onUpdate: (value) => values.push(value),
  });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 2);
  socket.reply(socket.sent[0], 'a');
  await a;
  await until(() => socket.sent.length === 2);
  socket.reply(socket.sent[1], 'b');
  await b;
  socket.event('a', 0, {}, 'fixture.notification');
  socket.event('b', 0, { ok: true }, 'fixture.notification');
  assert.deepEqual(values, [{ ok: true }]);
  assert.equal(state.client.getSnapshot().status, 'connected');
});

test('generic subscription emits snapshots/updates and serializes no callback or signal fields', async (t) => {
  const state = setup(t);
  const updates = [];
  const controller = new AbortController();
  const pending = subscribeFixture(state.client, {
    address: 'wallet',
    onUpdate: (value) => updates.push(value),
    signal: controller.signal,
  });
  await until(() => state.sockets.length === 1);
  const socket = state.sockets[0];
  socket.connect();
  await until(() => socket.sent.length === 1);
  assert.deepEqual(socket.sent[0].params, { address: 'wallet' });
  assert.equal(socket.sent[0].method, 'fixture.subscribe');
  socket.reply(socket.sent[0], 'balance');
  socket.event(
    'balance',
    0,
    { amount: { baseUnits: '0', decimals: 9 } },
    'fixture.notification',
  );
  await pending;
  socket.event(
    'balance',
    1,
    { amount: { baseUnits: '1000000000', decimals: 9 } },
    'fixture.notification',
  );
  assert.equal(updates.length, 2);
  controller.abort();
  assert.equal(socket.sent[1].method, 'fixture.unsubscribe');
  socket.reply(socket.sent[1], true);
});

test('subscription setups run concurrently with a bound; a slow first reply does not block other wallets', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const updates = [];
  const controllers = Array.from({ length: 7 }, () => new AbortController());
  const pending = controllers.map((controller, index) =>
    subscribeFixture(state.client, {
      address: `wallet-${index}`,
      signal: controller.signal,
      onUpdate: (value) => updates.push(value),
    }),
  );
  await until(() => socket.sent.length === 4);
  await delay(10);
  assert.equal(socket.sent.length, 4, 'only four setups may be in flight');
  const cancelled = assert.rejects(pending[4], { code: 'aborted' });
  controllers[4].abort();
  await cancelled;
  // Keep wallet-0 pending: each other completion should immediately free a slot.
  socket.reply(socket.sent[2], 'sub-2');
  socket.event('sub-2', 0, { balance: '42' });
  await pending[2];
  assert.deepEqual(updates, [{ balance: '42' }]);
  await until(() => socket.sent.length === 5);
  assert.equal(socket.sent[4].params.address, 'wallet-5');
  socket.reply(socket.sent[1], 'sub-1');
  await until(() => socket.sent.length === 6);
  assert.equal(socket.sent[5].params.address, 'wallet-6');
  for (const index of [0, 3, 4, 5])
    socket.reply(socket.sent[index], `sub-${index + 10}`);
  await Promise.all(pending.filter((_, index) => index !== 4));
  assert.equal(socket.sent.length, 6, 'cancelled queued wallet was never sent');
});

test('reconnect restores queued and in-flight subscriptions once with fresh concurrency slots', async (t) => {
  const state = setup(t);
  const first = await connected(state);
  const pending = Array.from({ length: 6 }, (_, index) =>
    subscribeFixture(state.client, {
      address: `wallet-${index}`,
      onUpdate: () => {},
    }),
  );
  await until(() => first.sent.length === 4);
  first.drop();
  await until(() => state.sockets.length === 2);
  const second = state.sockets[1];
  second.connect();
  await until(() => second.sent.length === 4);
  await delay(10);
  assert.equal(second.sent.length, 4);
  for (const request of second.sent.slice())
    second.reply(request, `restored-${request.params.address}`);
  await until(() => second.sent.length === 6);
  for (const request of second.sent.slice(4))
    second.reply(request, `restored-${request.params.address}`);
  await Promise.all(pending);
  assert.equal(
    new Set(second.sent.map((request) => request.params.address)).size,
    6,
  );
});

test('subscription created by a connected listener is sent once during handshake restoration', async (t) => {
  const state = setup(t);
  let pending;
  state.client.onStatusChange(() => {
    if (state.client.getSnapshot().status === 'connected' && !pending) {
      pending = subscribeFixture(state.client, {
        address: 'wallet',
        onUpdate: () => {},
      });
    }
  });
  const socket = await connected(state);
  await until(() => socket.sent.length === 1);
  await delay(10);
  assert.equal(socket.sent.length, 1);
  socket.reply(socket.sent[0], 'wallet-sub');
  await pending;
});

test('opt-in subscription batches register all handlers and acknowledge again on reconnect', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const ready = [],
    updates = [];
  const controllers = Array.from({ length: 35 }, () => new AbortController());
  const pending = controllers.map((controller, index) =>
    subscribeFixture(state.client, {
      address: `wallet-${index}`,
      initialSnapshot: false,
      batch: true,
      signal: controller.signal,
      onSubscribed: () => ready.push(index),
      onUpdate: (value) => updates.push(value),
    }),
  );
  await until(() => socket.sent.length > 0);
  assert.equal(socket.sent[0].length, 32);
  assert(
    socket.sent[0].every(
      (call) =>
        call.params.initialSnapshot === false && !('batch' in call.params),
    ),
  );
  socket.receive(
    socket.sent[0].map((call, i) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: `sub-${i}`,
    })),
  );
  socket.event('sub-0', 1, { amount: 'live-before-snapshot' });
  assert.equal(updates.length, 1);
  await until(() => socket.sent.length === 2);
  assert.equal(socket.sent[1].length, 3);
  socket.receive(
    socket.sent[1].map((call, i) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: `sub-${i + 32}`,
    })),
  );
  await Promise.all(pending);
  assert.equal(ready.length, 35);
  socket.drop();
  await until(() => state.sockets.length === 2);
  const next = state.sockets[1];
  next.connect();
  await until(() => next.sent.length === 1);
  next.receive(
    next.sent[0].map((call, i) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: `new-${i}`,
    })),
  );
  await until(() => next.sent.length === 2);
  next.receive(
    next.sent[1].map((call, i) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: `new-${i + 32}`,
    })),
  );
  await until(() => ready.length === 70);
});

test('signature subscription is one-shot and completed signatures are not resubscribed', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const updates = [];
  const ready = state.client.solana.subscribeSignature({
    signature: 'signature',
    onUpdate: (value) => updates.push(value),
  });
  await until(() =>
    socket.sent.some((r) => r.method === 'solana.signatureSubscribe'),
  );
  const request = socket.sent.find(
    (r) => r.method === 'solana.signatureSubscribe',
  );
  assert.deepEqual(request.params, { signature: 'signature' });
  socket.reply(request, 'sub');
  await ready;
  socket.event(
    'sub',
    1,
    { signature: 'signature', status: 'processed', err: null },
    'solana.signatureNotification',
  );
  socket.event(
    'sub',
    2,
    { signature: 'signature', status: 'processed', err: null },
    'solana.signatureNotification',
  );
  assert.equal(updates.length, 1);
  socket.drop();
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  await delay(20);
  assert.equal(
    state.sockets[1].sent.filter(
      (r) => r.method === 'solana.signatureSubscribe',
    ).length,
    0,
  );
});

test('unknown signature outcomes can be explicitly retried without restoring the completed watch', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const updates = [];
  const options = {
    signature: 'signature',
    onUpdate: (value) => updates.push(value),
  };
  const first = state.client.solana.subscribeSignature(options);
  await until(() => socket.sent.length === 1);
  socket.reply(socket.sent[0], 'first');
  await first;
  socket.event(
    'first',
    1,
    { signature: 'signature', status: 'unknown' },
    'solana.signatureNotification',
  );
  const retry = state.client.solana.subscribeSignature(options);
  await until(
    () =>
      socket.sent.filter((call) => call.method === 'solana.signatureSubscribe')
        .length === 2,
  );
  const request = socket.sent.find(
    (call) =>
      call.method === 'solana.signatureSubscribe' &&
      call.id !== socket.sent[0].id,
  );
  socket.reply(request, 'retry');
  await retry;
  socket.event(
    'retry',
    1,
    { signature: 'signature', status: 'processed' },
    'solana.signatureNotification',
  );
  assert.deepEqual(
    updates.map((value) => value.status),
    ['unknown', 'processed'],
  );
  assert.equal('getTransfer' in state.client.solana, false);
  assert.equal('getSwap' in state.client.solana.pump, false);
});

test('large valid request and connection timeouts do not overflow subscription setup', async (t) => {
  const state = setup(t, {
    connectionTimeoutMs: 2_147_483_647,
    requestTimeoutMs: 2_147_483_647,
  });
  const controller = new AbortController();
  const pending = state.client.solana.subscribeSignature({
    signature: 'signature',
    signal: controller.signal,
    onUpdate() {},
  });
  const cancelled = assert.rejects(pending, { code: 'aborted' });
  await delay(10);
  controller.abort();
  await cancelled;
});
