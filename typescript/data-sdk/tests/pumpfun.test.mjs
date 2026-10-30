import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpClient } from '../dist/index.js';
import { setup, authenticate, until, id } from './fixture.mjs';

const callout = {
  source: 'pumpfun',
  kind: 'callout',
  calloutId: 'one',
  chain: 'solana',
  author: {
    id: 'a',
    name: 'Author',
    walletAddress: 'wallet',
    avatarUrl: null,
    verified: false,
    xUsername: null,
  },
  token: { mint: 'mint', name: 'Coin', symbol: 'COIN', imageUrl: null },
  text: 'Callout',
  mediaUrl: null,
  flagged: false,
  createdAtMs: 1800000000000,
  receivedAtMs: 1800000000000,
};
const status = { state: 'live', lastEventAtMs: null };
function event(socket, subscription, sequence, result) {
  socket.receive({
    jsonrpc: '2.0',
    method: 'pumpfun.calloutNotification',
    params: { subscription, sequence, result },
  });
}

test('Pump.fun HTTP query validation and bounded, sanitized DTOs', async () => {
  let transform = (value) => value;
  const http = createHttpClient({
    url: 'http://localhost:5000',
    getToken: () => 'fixture',
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      assert.equal(request.method, 'pumpfun.getCallouts');
      assert.equal(request.params.limit, 20);
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          result: transform({ callouts: [callout], status }),
        }),
      );
    },
  });
  assert.deepEqual((await http.pumpfun.getCallouts({ limit: 20 })).callouts, [
    callout,
  ]);
  for (const limit of [0, 51, 1.5, '20'])
    await assert.rejects(http.pumpfun.getCallouts({ limit }), {
      code: 'invalid_params',
    });
  for (const modify of [
    (r) => ({ ...r, callouts: [{ ...callout, text: '', mediaUrl: null }] }),
    (r) => ({
      ...r,
      callouts: [{ ...callout, mediaUrl: 'javascript:alert(1)' }],
    }),
    (r) => ({ ...r, status: { state: 'unknown', lastEventAtMs: null } }),
    (r) => ({ ...r, callouts: Array(21).fill(callout) }),
  ]) {
    transform = modify;
    await assert.rejects(http.pumpfun.getCallouts({ limit: 20 }), {
      code: 'invalid_response',
    });
  }
});

test('Pump.fun rejects duplicate subscriptions, receives immediate ACK events and restores on reconnect', async (t) => {
  const state = setup(t);
  const updates = [];
  const first = state.client.pumpfun.subscribeCallouts({
    onUpdate: (update) => updates.push(update),
  });
  await assert.rejects(
    state.client.pumpfun.subscribeCallouts({ onUpdate() {} }),
    { code: 'duplicate_subscription' },
  );
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  assert.equal(socket.calls[1].method, 'pumpfun.subscribeCallouts');
  socket.reply(socket.calls[1], id(1));
  event(socket, id(1), 0, { type: 'status', status });
  event(socket, id(1), 1, { type: 'callout', callout });
  const stop = await first;
  assert.equal(updates.length, 2);
  event(socket, id(1), 1, { type: 'callout', callout });
  assert.equal(updates.length, 2);
  socket.drop();
  const restored = await authenticate(state, 1);
  await until(() => restored.calls.length === 2);
  restored.reply(restored.calls[1], id(2));
  event(restored, id(1), 2, { type: 'callout', callout });
  assert.equal(updates.length, 2);
  event(restored, id(2), 0, {
    type: 'status',
    status: { ...status, state: 'disconnected' },
  });
  assert.equal(updates.length, 3);
  stop();
  await until(() =>
    restored.calls.some(
      (call) => call.method === 'pumpfun.unsubscribeCallouts',
    ),
  );
  restored.reply(restored.calls.at(-1), true);
});

test('Pump.fun abort cleans up a late subscription acknowledgement', async (t) => {
  const state = setup(t),
    abort = new AbortController();
  const pending = state.client.pumpfun.subscribeCallouts({
    signal: abort.signal,
    onUpdate() {},
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  abort.abort();
  await assert.rejects(pending, { code: 'aborted' });
  socket.reply(socket.calls[1], id(1));
  await until(() =>
    socket.calls.some((call) => call.method === 'pumpfun.unsubscribeCallouts'),
  );
  socket.reply(socket.calls.at(-1), true);
});
