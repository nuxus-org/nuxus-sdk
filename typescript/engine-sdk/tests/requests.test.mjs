import { test } from 'node:test';
import assert from 'node:assert/strict';
import { until, setup, connected } from './fixture.mjs';

test('lazy requests share one public socket, preserve params and correlate out-of-order replies', async (t) => {
  const state = setup(t);
  const { client, sockets, protocols } = state;
  assert.equal(sockets.length, 0);
  const first = client.engine.ping();
  const second = client.solana.transfer({
    network: 'solana:devnet',
    sourceAddresses: ['source'],
    destinationAddresses: ['destination'],
    amountLamports: '1',
  });
  await until(() => sockets.length === 1);
  assert.equal(sockets[0].sent.length, 0);
  sockets[0].connect();
  await until(() => sockets[0].sent.length === 2);
  const [a, b] = sockets[0].sent;
  assert.equal(a.jsonrpc, '2.0');
  assert.equal(a.method, 'engine.ping');
  assert.deepEqual(b.params, {
    network: 'solana:devnet',
    sourceAddresses: ['source'],
    destinationAddresses: ['destination'],
    amountLamports: '1',
  });
  assert.equal(b.method, 'solana.transfer');
  assert.equal('requestId' in a, false);
  assert.equal('namespace' in a, false);
  sockets[0].reply(b, { transactions: [] });
  sockets[0].reply(a, { serverTimeMs: 42 });
  assert.deepEqual(await first, { serverTimeMs: 42 });
  assert.deepEqual(await second, { transactions: [] });
  assert.deepEqual(protocols[0], ['nuxus.v2']);
});

test('numeric RPC errors retain data and request timeouts leave the connection usable', async (t) => {
  const state = setup(t, { requestTimeoutMs: 30 });
  const socket = await connected(state);
  const promise = state.client.request({ method: 'unknown' });
  await until(() => socket.sent.length === 1);
  socket.receive({
    jsonrpc: '2.0',
    id: socket.sent[0].id,
    error: {
      code: -32601,
      message: 'Method not found',
      data: { kind: 'method_not_found' },
    },
  });
  await assert.rejects(
    promise,
    (error) => error.code === -32601 && error.data.kind === 'method_not_found',
  );
  await assert.rejects(state.client.engine.ping(), { code: 'request_timeout' });
  assert.equal(state.client.getSnapshot().status, 'connected');
});

test('batch sends one frame, matches out-of-order results, and preserves partial failures', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const pending = state.client.batch([
    { method: 'engine.ping' },
    { method: 'unknown' },
  ]);
  await until(() => socket.sent.length === 1);
  const [a, b] = socket.sent[0];
  socket.receive([
    {
      jsonrpc: '2.0',
      id: b.id,
      error: { code: -32601, message: 'Unknown method' },
    },
    { jsonrpc: '2.0', id: a.id, result: { ok: true } },
  ]);
  const results = await pending;
  assert.deepEqual(results[0], { status: 'fulfilled', value: { ok: true } });
  assert.equal(results[1].status, 'rejected');
  assert.equal(results[1].reason.code, -32601);
  await assert.rejects(state.client.batch([]), { code: 'invalid_batch' });
  await assert.rejects(
    state.client.batch(Array(33).fill({ method: 'engine.ping' })),
    { code: 'invalid_batch' },
  );
});
