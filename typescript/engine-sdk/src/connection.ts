import { EngineError } from './errors.js';
import { ENGINE_PROTOCOL, MAX_BATCH_SIZE } from './constants.js';
import { resolveOptions } from './options.js';
import { disconnected, record, safely } from './protocol.js';
import type {
  ConnectionSnapshot,
  EngineClientOptions,
  EngineSocket,
} from './types.js';

type Timer = ReturnType<typeof setTimeout>;
interface ConnectionHandlers {
  message(value: Record<string, unknown>, generation: number): void;
  connected(generation: number): void;
  disconnect(error: EngineError): void;
  stop(error: EngineError, report: boolean): void;
  heartbeat(): Promise<unknown>;
  canRequest(): boolean;
}

export class EngineConnection {
  readonly options: Required<EngineClientOptions>;
  private snapshot: ConnectionSnapshot = Object.freeze({
    status: 'idle',
    connectionId: null,
    error: null,
  });
  private readonly listeners = new Set<() => void>();
  private running = false;
  private generation = 0;
  private failures = 0;
  private socket?: EngineSocket;
  private attemptTimer?: Timer;
  private retryTimer?: Timer;
  private heartbeatTimer?: Timer;

  constructor(
    options: EngineClientOptions,
    private readonly handlers: ConnectionHandlers,
  ) {
    this.options = resolveOptions(options);
  }

  get version(): number {
    return this.generation;
  }

  get connected(): boolean {
    return (
      this.snapshot.status === 'connected' && this.socket?.readyState === 1
    );
  }

  send(payload: string): void {
    try {
      if (!this.socket) throw disconnected();
      this.socket.send(payload);
    } catch {
      this.fail(this.generation, disconnected());
    }
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot;
  onStatusChange = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    void this.attempt();
  }

  stop(): void {
    this.running = false;
    this.generation++;
    clearTimeout(this.retryTimer);
    this.cleanup(disconnected());
    this.handlers.stop(disconnected(), false);
    this.update({ status: 'stopped', error: null });
  }

  ready(): Promise<void> {
    this.start();
    if (this.snapshot.status === 'connected') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        remove();
        reject(
          new EngineError(
            'connection_timeout',
            'Waiting for engine connection timed out.',
          ),
        );
      }, this.options.connectionTimeoutMs);
      const check = (): void => {
        if (this.snapshot.status === 'connected') {
          clearTimeout(timer);
          remove();
          resolve();
        } else if (this.snapshot.status === 'stopped') {
          clearTimeout(timer);
          remove();
          reject(this.snapshot.error ?? disconnected());
        }
      };
      const remove = this.onStatusChange(check);
      check();
    });
  }

  close(): void {
    this.stop();
  }

  current(generation: number): boolean {
    return this.running && this.generation === generation;
  }

  private update(change: Partial<ConnectionSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...change });
    for (const listener of this.listeners) safely(listener);
  }

  private async attempt(): Promise<void> {
    const generation = ++this.generation;
    this.update({
      status: 'connecting',
      connectionId: null,
    });
    // Allow immediate teardown (including React StrictMode) before opening a socket.
    await Promise.resolve();
    if (!this.current(generation)) return;
    this.attemptTimer = setTimeout(
      () =>
        this.fail(
          generation,
          new EngineError('connection_timeout', 'Engine handshake timed out.'),
        ),
      this.options.connectionTimeoutMs,
    );
    try {
      const socket = this.options.createWebSocket(this.options.url, [
        ENGINE_PROTOCOL,
      ]);
      this.socket = socket;
      socket.onmessage = (event): void => {
        if (this.current(generation)) this.receive(event.data, generation);
      };
      socket.onerror = (): void =>
        this.fail(
          generation,
          new EngineError('connection_error', 'Engine connection failed.'),
        );
      socket.onclose = (): void => this.fail(generation, disconnected());
    } catch (cause) {
      // Keep transport failures consistent across WebSocket implementations.
      this.fail(
        generation,
        cause instanceof EngineError
          ? cause
          : new EngineError(
              'connection_error',
              'Could not establish an engine connection.',
            ),
      );
    }
  }

  fail(generation: number, error: EngineError): void {
    if (!this.current(generation)) return;
    this.generation++;
    const retryGeneration = this.generation;
    this.cleanup(error);
    if (!error.retryable) {
      this.running = false;
      this.handlers.stop(error, true);
      this.update({ status: 'stopped', error });
      return;
    }
    const ceiling = Math.min(
      this.options.reconnectMaxDelayMs,
      this.options.reconnectMinDelayMs * 2 ** Math.min(this.failures++, 20),
    );
    const delay = Math.max(
      this.options.reconnectMinDelayMs,
      ceiling * (0.5 + Math.random() * 0.5),
    );
    this.update({ status: 'reconnecting', error });
    if (!this.current(retryGeneration)) return;
    this.retryTimer = setTimeout(() => {
      if (this.running) void this.attempt();
    }, delay);
  }

  private cleanup(error: EngineError): void {
    clearTimeout(this.attemptTimer);
    clearTimeout(this.heartbeatTimer);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = (): void => {};
      try {
        socket.close(1000, 'Client disconnected');
      } catch {
        /* Already closed. */
      }
    }
    this.handlers.disconnect(error);
    this.snapshot = Object.freeze({
      ...this.snapshot,
      connectionId: null,
    });
  }

  private receive(raw: unknown, generation: number): void {
    let value: unknown;
    try {
      value = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      value = null;
    }
    if (Array.isArray(value)) {
      if (!value.length || value.length > MAX_BATCH_SIZE) {
        this.fail(
          generation,
          new EngineError('invalid_message', 'Invalid response batch.'),
        );
        return;
      }
      for (const message of value) {
        if (!this.current(generation)) break;
        this.receiveMessage(message, generation);
      }
    } else this.receiveMessage(value, generation);
  }

  private receiveMessage(message: unknown, generation: number): void {
    const invalid = (): void =>
      this.fail(
        generation,
        new EngineError('invalid_message', 'Invalid JSON-RPC engine message.'),
      );
    if (!record(message) || message.jsonrpc !== '2.0') {
      invalid();
      return;
    }
    if (message.method === 'engine.connected' && !('id' in message)) {
      const params = message.params;
      if (
        this.snapshot.status !== 'connecting' ||
        !record(params) ||
        typeof params.connectionId !== 'string' ||
        params.connectionId.length === 0
      ) {
        this.fail(
          generation,
          new EngineError(
            'invalid_handshake',
            'Invalid engine connection response.',
          ),
        );
        return;
      }
      clearTimeout(this.attemptTimer);
      this.failures = 0;
      this.update({
        status: 'connected',
        connectionId: params.connectionId,
        error: null,
      });
      if (!this.current(generation)) return;
      this.heartbeat(generation);
      this.handlers.connected(generation);
      return;
    }
    if (this.snapshot.status !== 'connected') {
      this.fail(
        generation,
        new EngineError(
          'invalid_handshake',
          'Expected engine connection notification.',
        ),
      );
      return;
    }
    this.handlers.message(message, generation);
  }

  private heartbeat(generation: number): void {
    if (!this.options.heartbeatIntervalMs) return;
    this.heartbeatTimer = setTimeout(() => {
      if (!this.current(generation)) return;
      if (!this.handlers.canRequest()) {
        this.heartbeat(generation);
        return;
      }
      void this.handlers.heartbeat().then(
        () => {
          if (this.current(generation)) this.heartbeat(generation);
        },
        () =>
          this.fail(
            generation,
            new EngineError('heartbeat_failed', 'Engine heartbeat failed.'),
          ),
      );
    }, this.options.heartbeatIntervalMs);
  }
}
