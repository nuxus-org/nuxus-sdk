import { EngineConnection } from './connection.js';
import { RequestManager } from './request-manager.js';
import { SubscriptionManager } from './subscription-manager.js';
import { createSolanaApi } from './solana.js';
import type {
  BatchResult,
  ConnectionSnapshot,
  EngineClientOptions,
  EngineRequest,
  EngineSubscription,
  SubscriptionOptions,
  Unsubscribe,
} from './types.js';

export class EngineClient {
  private readonly connection: EngineConnection;
  private readonly requests: RequestManager;
  private readonly subscriptions: SubscriptionManager;

  constructor(options: EngineClientOptions) {
    this.connection = new EngineConnection(options, {
      message: (message, generation): void => {
        if ('id' in message) this.requests.receive(message, generation);
        else this.subscriptions.receive(message, generation);
      },
      connected: (generation): void => this.subscriptions.restore(generation),
      disconnect: (error): void => {
        this.requests.clear(error);
        this.subscriptions.reset();
      },
      stop: (error, report): void => this.subscriptions.close(error, report),
      heartbeat: (): Promise<unknown> => this.engine.ping(),
      canRequest: (): boolean => this.requests.capacity > 0,
    });
    this.requests = new RequestManager(this.connection, (generation) =>
      this.subscriptions.drain(generation),
    );
    this.subscriptions = new SubscriptionManager(
      this.connection,
      this.requests,
    );
  }

  readonly solana = createSolanaApi({
    request: <T>(input: EngineRequest, minimumTimeoutMs?: number): Promise<T> =>
      this.requests.request<T>(input, minimumTimeoutMs),
    subscribe: <T>(
      input: EngineSubscription,
      handlers: SubscriptionOptions<T>,
    ): Promise<Unsubscribe> => this.subscribe(input, handlers),
  });
  readonly engine = {
    ping: (): Promise<{ connectionId: string; serverTimeMs: number }> =>
      this.request({ method: 'engine.ping' }),
  };
  getSnapshot = (): ConnectionSnapshot => this.connection.getSnapshot();
  onStatusChange = (listener: () => void): (() => void) =>
    this.connection.onStatusChange(listener);

  /** Connect eagerly; ordinary calls start the shared connection lazily. */
  start(): void {
    this.connection.start();
  }

  /** Cancel pending work and subscriptions, and stop reconnecting. */
  stop(): void {
    this.connection.stop();
  }

  close(): void {
    this.stop();
  }

  /** Sent requests are never replayed after a disconnect. */
  request<T = unknown>(input: EngineRequest): Promise<T> {
    return this.requests.request<T>(input);
  }

  batch<T = unknown>(inputs: EngineRequest[]): Promise<BatchResult<T>[]> {
    return this.requests.batch<T>(inputs);
  }

  subscribe<T>(
    input: EngineSubscription,
    handlers: SubscriptionOptions<T>,
  ): Promise<Unsubscribe> {
    return this.subscriptions.subscribe(input, handlers);
  }
}

export function createClient(options: EngineClientOptions): EngineClient {
  return new EngineClient(options);
}
