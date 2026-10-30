import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '../dist/index.js';

export { delay };
export async function until(check, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    assert.ok(Date.now() < deadline, 'Condition timed out');
    await delay(2);
  }
}
export const id = (value) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export function price(stream = 'btcusdt@miniTicker', changes = {}) {
  return {
    source: 'binance',
    stream,
    symbol: stream.split('@')[0].toUpperCase(),
    price: '18446744073709551615.000000001',
    updatedAtMs: 1800000000000,
    receivedAtMs: 1800000000001,
    status: 'live',
    ...changes,
  };
}
export class Socket {
  readyState = 0;
  onopen = null;
  onmessage = null;
  onerror = null;
  onclose = null;
  frames = [];
  times = [];
  closed = false;
  get calls() {
    return this.frames.flat();
  }
  send(text) {
    const frame = JSON.parse(text);
    this.frames.push(frame);
    for (const call of [frame].flat())
      this.times.push({ method: call.method, at: Date.now() });
    this.onSend?.(frame);
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  reply(call, result) {
    this.receive({ jsonrpc: '2.0', id: call.id, result });
  }
  error(call, code, message = 'Fixture error', data) {
    this.receive({
      jsonrpc: '2.0',
      id: call.id,
      error: { code, message, data },
    });
  }
  event(subscription, sequence, result) {
    this.receive({
      jsonrpc: '2.0',
      method: 'binance.priceNotification',
      params: { subscription, sequence, result },
    });
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}
export function setup(t, options = {}) {
  const sockets = [],
    tokens = [];
  const client = createClient({
    url: 'ws://localhost:5000/',
    getToken: ({ signal }) => {
      tokens.push(signal);
      return `fixture-token-${tokens.length}`;
    },
    createWebSocket: (url) => {
      assert.equal(url, 'ws://localhost:5000/');
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    heartbeatIntervalMs: 0,
    connectionTimeoutMs: 500,
    requestTimeoutMs: 500,
    subscriptionTimeoutMs: 1500,
    reconnectMinDelayMs: 5,
    reconnectMaxDelayMs: 20,
    requestsPerSecond: 1000,
    ...options,
  });
  t.after(() => client.close());
  return { client, sockets, tokens };
}
export async function authenticate(state, index = 0) {
  await until(() => state.sockets.length > index);
  const socket = state.sockets[index];
  socket.open();
  await until(() =>
    socket.calls.some((call) => call.method === 'authenticate'),
  );
  const auth = socket.calls.find((call) => call.method === 'authenticate');
  assert.ok(
    !Array.isArray(socket.frames[0]),
    'authentication must be standalone',
  );
  assert.equal(socket.calls.length, 1);
  socket.reply(auth, true);
  await until(() => state.client.getSnapshot().status === 'connected');
  return socket;
}
export async function connected(state) {
  state.client.start();
  return authenticate(state);
}
