import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, EngineError } from '../dist/index.js';
import { delay, until, Socket, setup, connected } from './fixture.mjs';

test('public reconnect; requests sent before disconnect are rejected and never replayed', async (t) => {
  const state = setup(t);
  const socket = await connected(state);
  const pending = state.client.request({
    method: 'solana.transfer',
    params: { walletId: 'wallet' },
  });
  const rejected = assert.rejects(pending, { code: 'disconnected' });
  await until(() => socket.sent.length === 1);
  socket.drop();
  await rejected;
  await until(() => state.sockets.length === 2);
  assert.deepEqual(state.protocols[1], ['nuxus.v2']);
  state.sockets[1].connect();
  await delay(5);
  assert.equal(state.sockets[1].sent.length, 0);
});

test('close during handshake ignores late events across restart', async (t) => {
  const state = setup(t);
  state.client.start();
  await until(() => state.sockets.length === 1);
  const old = state.sockets[0];
  const late = old.onmessage;
  state.client.close();
  state.client.start();
  late({
    data: JSON.stringify({
      jsonrpc: '2.0',
      method: 'engine.connected',
      params: { connectionId: 'old' },
    }),
  });
  assert.equal(state.client.getSnapshot().status, 'connecting');
  assert.equal(old.closed, true);
  await until(() => state.sockets.length === 2);
  state.sockets[1].connect();
  assert.equal(state.client.getSnapshot().status, 'connected');
});

test('transport construction failure retries without credentials', async (t) => {
  let attempts = 0;
  const socket = new Socket();
  const state = setup(t, {
    createWebSocket: (_, protocols) => {
      assert.deepEqual(protocols, ['nuxus.v2']);
      if (++attempts === 1) throw new Error('temporary');
      return socket;
    },
  });
  const pending = state.client.engine.ping();
  await until(() => attempts === 2);
  socket.connect();
  await until(() => socket.sent.length === 1);
  socket.reply(socket.sent[0], {});
  await pending;
});

test('unresponsive handshake times out and closes abandoned sockets', async (t) => {
  const state = setup(t, { connectionTimeoutMs: 20 });
  await assert.rejects(state.client.engine.ping(), {
    code: 'connection_timeout',
  });
  await until(() => state.sockets.length >= 2);
  assert.equal(state.sockets[0].closed, true);
});

test('missed heartbeat reconnects without credentials', async (t) => {
  const state = setup(t, { heartbeatIntervalMs: 10, requestTimeoutMs: 10 });
  const socket = await connected(state);
  await until(() => state.sockets.length === 2);
  assert.equal(socket.sent[0].method, 'engine.ping');
  assert.deepEqual(state.protocols[1], ['nuxus.v2']);
});

test('invalid readiness notification never becomes connected', async (t) => {
  const state = setup(t);
  state.client.start();
  await until(() => state.sockets.length === 1);
  state.sockets[0].receive({
    jsonrpc: '2.0',
    method: 'engine.connected',
    params: {},
  });
  assert.equal(state.client.getSnapshot().status, 'reconnecting');
  assert.equal(state.sockets[0].closed, true);
});

test('a URL is sufficient to create a public engine client', () => {
  const client = createClient({ url: 'ws://localhost:4000/ws' });
  assert.equal(client.getSnapshot().status, 'idle');
  client.close();
});

test('immediate teardown cancels socket creation and a fresh start still connects', async (t) => {
  const state = setup(t);
  state.client.start();
  state.client.close();
  state.client.start();
  await until(() => state.sockets.length === 1);
  state.sockets[0].connect();
  assert.equal(state.client.getSnapshot().status, 'connected');
  assert.deepEqual(state.protocols, [['nuxus.v2']]);
});

test('invalid endpoint errors never disclose caller input', () => {
  for (const url of [
    'private-credential',
    'wss://user:private-credential@example.com/ws',
    'wss://example.com/?token=private-credential',
  ]) {
    assert.throws(
      () => createClient({ url }),
      (error) =>
        error instanceof EngineError &&
        error.code === 'invalid_url' &&
        !error.message.includes('private-credential'),
    );
  }
});

test('explicit undefined options use defaults and invalid timer values fail early', async (t) => {
  const state = setup(t, {
    requestTimeoutMs: undefined,
    connectionTimeoutMs: undefined,
  });
  const socket = await connected(state);
  const pending = state.client.engine.ping();
  await until(() => socket.sent.length === 1);
  await delay(5);
  socket.reply(socket.sent[0], { connectionId: 'test', serverTimeMs: 123 });
  assert.deepEqual(await pending, { connectionId: 'test', serverTimeMs: 123 });
  for (const key of [
    'connectionTimeoutMs',
    'requestTimeoutMs',
    'reconnectMinDelayMs',
    'reconnectMaxDelayMs',
    'heartbeatIntervalMs',
  ]) {
    for (const value of [-1, 0.5, Infinity, NaN, 2_147_483_648]) {
      assert.throws(
        () => createClient({ url: 'wss://example.com/', [key]: value }),
        { code: 'invalid_options' },
      );
    }
  }
});

test('connection snapshots cannot be mutated by consumers', async (t) => {
  const state = setup(t);
  const idle = state.client.getSnapshot();
  assert.throws(() => {
    idle.status = 'connected';
  }, TypeError);
  await connected(state);
  assert.equal(idle.status, 'idle');
  const ready = state.client.getSnapshot();
  assert.throws(() => {
    ready.connectionId = 'modified';
  }, TypeError);
  state.client.stop();
  assert.equal(ready.status, 'connected');
  assert.equal(state.client.getSnapshot().status, 'stopped');
  assert.equal(state.client.getSnapshot().connectionId, null);
});
