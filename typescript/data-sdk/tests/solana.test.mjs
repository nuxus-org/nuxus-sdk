import assert from 'node:assert/strict';
import test from 'node:test';
import { createHttpClient } from '../dist/index.js';
import { setup, authenticate, until, id } from './fixture.mjs';

const address = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';
function snapshot(token = false, slot = 100, amount = '18446744073709551615') {
  return {
    network: 'solana:devnet',
    commitment: 'finalized',
    context: { slot },
    address,
    exists: true,
    amount: { baseUnits: amount, decimals: token ? 6 : 9 },
    ...(token
      ? {
          mint,
          tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
          tokenAccount: mint,
          frozen: true,
          scope: 'associatedTokenAccount',
        }
      : { asset: 'solana:native' }),
  };
}
function result(token = false) {
  const s = snapshot(token);
  const { address, exists, amount, tokenAccount, frozen, ...meta } = s;
  return {
    ...meta,
    balances: [
      { address, exists, amount, ...(token ? { tokenAccount, frozen } : {}) },
    ],
  };
}
function event(socket, subscription, sequence, value, token = false) {
  socket.receive({
    jsonrpc: '2.0',
    method: token
      ? 'solana.tokenBalanceNotification'
      : 'solana.balanceNotification',
    params: { subscription, sequence, result: value },
  });
}

test('native/token HTTP queries preserve u64 and reject mismatched or numeric balances', async () => {
  let transform = (value) => value;
  const http = createHttpClient({
    url: 'http://localhost:5000',
    getToken: () => 'fixture',
    fetch: async (_url, options) => {
      const call = JSON.parse(options.body);
      assert.equal(call.params.network, 'solana:devnet');
      assert.equal(call.params.commitment, 'finalized');
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: call.id,
          result: transform(result(call.method === 'solana.getTokenBalances')),
        }),
      );
    },
  });
  assert.equal(
    (
      await http.solana.getNativeBalances({
        network: 'solana:devnet',
        addresses: [address],
      })
    ).balances[0].amount.baseUnits,
    '18446744073709551615',
  );
  const token = await http.solana.getTokenBalances({
    network: 'solana:devnet',
    addresses: [address],
    mint,
  });
  assert.equal(token.balances[0].frozen, true);
  for (const change of [
    (r) => ({ ...r, network: 'solana:mainnet-beta' }),
    (r) => ({ ...r, balances: [] }),
    (r) => ({ ...r, balances: [{ ...r.balances[0], address: mint }] }),
    (r) => ({
      ...r,
      balances: [{ ...r.balances[0], amount: { baseUnits: 10, decimals: 9 } }],
    }),
  ]) {
    transform = change;
    await assert.rejects(
      http.solana.getNativeBalances({
        network: 'solana:devnet',
        addresses: [address],
      }),
      { code: 'invalid_response' },
    );
  }
});
test('Solana subscriptions map batched ACKs synchronously, ignore older slots and recover after transient error', async (t) => {
  const state = setup(t);
  const native = [],
    token = [],
    unavailable = [];
  const first = state.client.solana.subscribeBalance({
    network: 'solana:devnet',
    address,
    onUpdate: (v) => native.push(v),
    onUnavailable: (e) => unavailable.push(e),
  });
  const second = state.client.solana.subscribeTokenBalance({
    network: 'solana:devnet',
    address,
    mint,
    onUpdate: (v) => token.push(v),
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 3);
  socket.receive(
    socket.calls.slice(1).map((call, index) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: id(index + 1),
    })),
  );
  event(socket, id(1), 0, snapshot());
  event(socket, id(2), 0, snapshot(true), true);
  const stop = await first;
  await second;
  assert.equal(native.length, 1);
  assert.equal(token.length, 1);
  event(socket, id(1), 1, snapshot(false, 99, '1'));
  assert.equal(native.length, 1);
  socket.receive({
    jsonrpc: '2.0',
    method: 'solana.balanceNotification',
    params: {
      subscription: id(1),
      sequence: 2,
      error: { code: -32010, message: 'Worker restarting' },
    },
  });
  assert.equal(unavailable.length, 1);
  assert.equal(unavailable[0].retryable, true);
  event(socket, id(1), 3, snapshot(false, 101, '2'));
  assert.equal(native.at(-1).amount.baseUnits, '2');
  socket.drop();
  const restored = await authenticate(state, 1);
  await until(() => restored.calls.length === 3);
  restored.receive(
    restored.calls.slice(1).map((call, index) => ({
      jsonrpc: '2.0',
      id: call.id,
      result: id(index + 3),
    })),
  );
  event(restored, id(1), 4, snapshot(false, 200, '3'));
  assert.equal(native.length, 2);
  event(restored, id(3), 0, snapshot(false, 102, '4'));
  assert.equal(native.at(-1).amount.baseUnits, '4');
  stop();
  await until(() =>
    restored.calls.some((c) => c.method === 'solana.unsubscribeBalance'),
  );
  restored.reply(
    restored.calls.find((c) => c.method === 'solana.unsubscribeBalance'),
    true,
  );
});
test('Solana rejects invalid parameters before IO and abort releases late ACKs', async (t) => {
  const state = setup(t);
  for (const params of [
    { addresses: [] },
    { addresses: [address, address] },
    { addresses: ['bad'] },
    { addresses: [address], network: 'solana:testnet' },
  ])
    assert.throws(() => state.client.solana.getNativeBalances(params), {
      code: 'invalid_params',
    });
  assert.throws(
    () =>
      state.client.solana.subscribeTokenBalance({
        address,
        mint: 'bad',
        onUpdate() {},
      }),
    { code: 'invalid_params' },
  );
  assert.equal(state.sockets.length, 0);
  const abort = new AbortController();
  const pending = state.client.solana.subscribeBalance({
    address,
    signal: abort.signal,
    onUpdate() {},
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  abort.abort();
  await assert.rejects(pending, { code: 'aborted' });
  socket.reply(socket.calls[1], id(1));
  await until(() =>
    socket.calls.some((c) => c.method === 'solana.unsubscribeBalance'),
  );
  socket.reply(socket.calls.at(-1), true);
});
test('mismatched token mint does not reach the callback', async (t) => {
  const state = setup(t);
  const values = [];
  const pending = state.client.solana.subscribeTokenBalance({
    network: 'solana:devnet',
    address,
    mint,
    onUpdate: (v) => values.push(v),
  });
  const socket = await authenticate(state);
  await until(() => socket.calls.length === 2);
  socket.reply(socket.calls[1], id(1));
  await pending;
  event(socket, id(1), 0, { ...snapshot(true), mint: address }, true);
  assert.equal(values.length, 0);
  assert.equal(socket.closed, true);
});
