import assert from 'node:assert/strict';
import { createClient } from '../dist/index.js';

export function subscribeFixture(client, options) {
  const { onUpdate, onError, onSubscribed, batch, signal, ...params } = options;
  return client.subscribe(
    {
      method: 'fixture.subscribe',
      notification: 'fixture.notification',
      unsubscribe: 'fixture.unsubscribe',
      params,
    },
    { onUpdate, onError, onSubscribed, batch, signal },
  );
}

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(condition) {
  const end = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() >= end) assert.fail('Condition timed out');
    await delay(2);
  }
}

export class Socket {
  readyState = 0;
  onmessage = null;
  onerror = null;
  onclose = null;
  sent = [];
  closed = false;
  send(raw) {
    this.sent.push(JSON.parse(raw));
  }
  receive(message) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  connect() {
    this.readyState = 1;
    this.receive({
      jsonrpc: '2.0',
      method: 'engine.connected',
      params: { connectionId: 'connection' },
    });
  }
  close() {
    this.readyState = 3;
    this.closed = true;
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006 });
  }
  reply(request, result) {
    this.receive({ jsonrpc: '2.0', id: request.id, result });
  }
  event(subscription, sequence, result, method = 'fixture.notification') {
    this.receive({
      jsonrpc: '2.0',
      method,
      params: { subscription, sequence, result },
    });
  }
}

export function setup(t, options = {}) {
  const sockets = [],
    protocols = [];
  const client = createClient({
    url: 'ws://localhost:4000/ws',
    heartbeatIntervalMs: 0,
    connectionTimeoutMs: 500,
    requestTimeoutMs: 500,
    reconnectMinDelayMs: 5,
    reconnectMaxDelayMs: 20,
    createWebSocket: (url, offered) => {
      assert.equal(url, 'ws://localhost:4000/ws');
      protocols.push(offered);
      const socket = new Socket();
      sockets.push(socket);
      return socket;
    },
    ...options,
  });
  t.after(() => client.close());
  return { client, sockets, protocols };
}

export async function connected(state) {
  state.client.start();
  await until(() => state.sockets.length === 1);
  state.sockets[0].connect();
  return state.sockets[0];
}
