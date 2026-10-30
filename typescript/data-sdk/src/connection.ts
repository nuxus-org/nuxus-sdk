import { resolveOptions } from './options.js';
import { obtainToken } from './authentication.js';
import {
  cancelled,
  disconnected,
  invalidResponse,
  readPong,
  record,
  safely,
} from './protocol.js';
import { RequestQueue, type QueueOptions } from './request-queue.js';
import {
  DataError,
  type ConnectionSnapshot,
  type DataClientOptions,
  type DataSocket,
} from './types.js';

export class DataConnection {
  private readonly options: Required<DataClientOptions>;
  private snapshot: ConnectionSnapshot = Object.freeze({
    status: 'idle',
    connectionVersion: 0,
    error: null,
  });
  private readonly listeners = new Set<() => void>();
  private socket: DataSocket | undefined;
  private queue: RequestQueue | undefined;
  private running = false;
  private generation = 0;
  private failures = 0;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private tokenAbort: AbortController | undefined;

  constructor(
    options: DataClientOptions,
    private readonly onNotification: (value: Record<string, unknown>) => void,
  ) {
    this.options = resolveOptions(options);
  }

  getSnapshot = (): ConnectionSnapshot => this.snapshot;
  onStatusChange = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  };
  get subscriptionTimeoutMs(): number {
    return this.options.subscriptionTimeoutMs;
  }

  recover(error: DataError): void {
    this.fail(this.generation, error);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.failures = 0;
    void this.attempt();
  }

  stop(error = new DataError('closed', 'Data client closed.')): void {
    this.running = false;
    this.generation++;
    clearTimeout(this.retry);
    this.teardown(error);
    this.update({ status: 'stopped', error });
  }

  async request<T>(
    method: string,
    params: object | undefined,
    parse: (value: unknown) => T,
    options: QueueOptions<T> = {},
  ): Promise<T> {
    await this.ready(options.signal);
    if (this.snapshot.status !== 'connected' || !this.queue)
      throw disconnected();
    return this.queue.request(method, params, parse, options);
  }

  private ready(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(cancelled());
    this.start();
    if (this.snapshot.status === 'connected') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let remove = (): void => {};
      const cleanup = (): void => {
        clearTimeout(timer);
        remove();
        signal?.removeEventListener('abort', abort);
      };
      const abort = (): void => {
        cleanup();
        reject(cancelled());
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new DataError(
            'connection_timeout',
            'Data connection timed out.',
            true,
          ),
        );
      }, this.options.connectionTimeoutMs);
      const check = (): void => {
        if (this.snapshot.status === 'connected') {
          cleanup();
          resolve();
        } else if (this.snapshot.status === 'stopped') {
          cleanup();
          reject(this.snapshot.error ?? disconnected());
        }
      };
      remove = this.onStatusChange(check);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }

  private update(change: Partial<ConnectionSnapshot>): void {
    this.snapshot = Object.freeze({ ...this.snapshot, ...change });
    for (const listener of this.listeners) safely(listener);
  }

  private async attempt(): Promise<void> {
    if (!this.running) return;
    const generation = ++this.generation;
    const abort = new AbortController();
    this.tokenAbort = abort;
    this.update({
      status: this.failures ? 'reconnecting' : 'connecting',
      error: null,
    });
    if (!this.current(generation)) return;
    this.deadline = setTimeout(
      () =>
        this.fail(
          generation,
          new DataError(
            'connection_timeout',
            'Data connection timed out.',
            true,
          ),
        ),
      this.options.connectionTimeoutMs,
    );
    let token: string;
    try {
      token = await obtainToken(this.options.getToken, abort.signal);
    } catch (error) {
      if (this.current(generation))
        this.fail(
          generation,
          error instanceof DataError
            ? error
            : new DataError('token_error', 'Could not obtain a data token.'),
        );
      return;
    }
    if (!this.current(generation)) return;
    let socket: DataSocket;
    try {
      socket = this.options.createWebSocket(this.options.url);
    } catch {
      this.fail(
        generation,
        new DataError(
          'connection_error',
          'Could not open the data connection.',
          true,
        ),
      );
      return;
    }
    this.socket = socket;
    const queue = new RequestQueue(
      (text) => socket.send(text),
      this.options.requestTimeoutMs,
      this.options.requestsPerSecond,
      (error) => this.fail(generation, error),
    );
    this.queue = queue;
    socket.onopen = (): void => {
      if (!this.current(generation)) return;
      socket.onopen = null;
      this.update({ status: 'authenticating' });
      if (!this.current(generation)) return;
      void queue
        .request(
          'authenticate',
          { token },
          (value): true => {
            if (value !== true) throw invalidResponse();
            return true;
          },
          { authentication: true },
        )
        .then(() => {
          if (!this.current(generation)) return;
          clearTimeout(this.deadline);
          this.failures = 0;
          this.update({
            status: 'connected',
            connectionVersion: this.snapshot.connectionVersion + 1,
            error: null,
          });
          this.scheduleHeartbeat(generation);
        })
        .catch((error: unknown) =>
          this.fail(
            generation,
            error instanceof DataError ? error : invalidResponse(),
          ),
        );
    };
    socket.onmessage = (event): void => {
      if (!this.current(generation)) return;
      try {
        if (typeof event.data !== 'string' || event.data.length > 1024 * 1024)
          throw invalidResponse();
        const frame: unknown = JSON.parse(event.data);
        const messages = Array.isArray(frame) ? frame : [frame];
        if (!messages.length || messages.length > 32) throw invalidResponse();
        for (const message of messages) {
          if (!this.current(generation)) break;
          if (!record(message) || message.jsonrpc !== '2.0')
            throw invalidResponse();
          if ('id' in message) queue.receive(message);
          else if (
            typeof message.method === 'string' &&
            this.snapshot.status === 'connected'
          )
            this.onNotification(message);
        }
      } catch {
        this.fail(generation, invalidResponse());
      }
    };
    socket.onerror = (): void =>
      this.fail(
        generation,
        new DataError('connection_error', 'Data WebSocket failed.', true),
      );
    socket.onclose = (event): void =>
      this.fail(
        generation,
        new DataError(
          event.code === 1008 ? 'connection_rejected' : 'disconnected',
          event.code === 1008
            ? 'Data connection rejected.'
            : 'Data connection lost.',
          event.code !== 1008,
        ),
      );
  }

  private current(generation: number): boolean {
    return this.running && generation === this.generation;
  }

  private scheduleHeartbeat(generation: number): void {
    if (!this.options.heartbeatIntervalMs || !this.current(generation)) return;
    this.heartbeat = setTimeout(() => {
      void this.request('ping', undefined, readPong)
        .then(() => this.scheduleHeartbeat(generation))
        .catch((error: unknown) =>
          this.fail(
            generation,
            error instanceof DataError ? error : disconnected(),
          ),
        );
    }, this.options.heartbeatIntervalMs);
  }

  private fail(generation: number, error: DataError): void {
    if (!this.current(generation)) return;
    if (!error.retryable) {
      this.stop(error);
      return;
    }
    this.generation++;
    this.teardown(error);
    const nextGeneration = this.generation;
    this.update({ status: 'reconnecting', error });
    if (!this.running || this.generation !== nextGeneration) return;
    const delay = Math.min(
      this.options.reconnectMaxDelayMs,
      this.options.reconnectMinDelayMs * 2 ** Math.min(this.failures++, 10),
    );
    this.retry = setTimeout(
      () => {
        void this.attempt();
      },
      delay + Math.random() * delay * 0.2,
    );
  }

  private teardown(error: DataError): void {
    clearTimeout(this.deadline);
    clearTimeout(this.heartbeat);
    this.tokenAbort?.abort();
    this.tokenAbort = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = (): void => {};
      try {
        socket.close(1000, 'Data client disconnected');
      } catch {
        /* Already closed. */
      }
    }
    this.queue?.close(error);
    this.queue = undefined;
  }
}
