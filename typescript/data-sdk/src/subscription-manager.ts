import type { DataConnection } from './connection.js';
import {
  cancelled,
  invalidResponse,
  readSubscriptionId,
  record,
  safely,
} from './protocol.js';
import {
  DataError,
  type SubscriptionOptions,
  type Unsubscribe,
} from './types.js';

interface Specification<T> {
  method: string;
  notification: string;
  unsubscribe: string;
  params: object;
  parse(value: unknown): T;
  slot?(value: T): number;
}
interface Subscription<T> {
  key: string;
  spec: Specification<T>;
  slot?: number;
  options: SubscriptionOptions<T>;
  active: boolean;
  settled: boolean;
  serverId?: string;
  version?: number;
  sequence: number;
  resolve: (cancel: Unsubscribe) => void;
  reject: (error: DataError) => void;
  cancel: Unsubscribe;
  timer: ReturnType<typeof setTimeout>;
  detach?: () => void;
}

export class SubscriptionManager<T> {
  private readonly items = new Map<string, Subscription<T>>();
  private readonly remote = new Map<string, Subscription<T>>();

  constructor(private readonly connection: DataConnection) {
    connection.onStatusChange(() => {
      const state = connection.getSnapshot();
      if (state.status === 'connected') {
        for (const item of this.items.values()) this.register(item);
      } else {
        this.remote.clear();
        for (const item of this.items.values()) {
          item.serverId = undefined;
          item.slot = undefined;
          item.version = undefined;
          item.sequence = -1;
        }
        if (state.status === 'stopped')
          this.close(
            state.error ?? new DataError('closed', 'Data client stopped.'),
          );
      }
    });
  }

  subscribe(
    key: string,
    spec: Specification<T>,
    options: SubscriptionOptions<T>,
  ): Promise<Unsubscribe> {
    if (typeof options.onUpdate !== 'function')
      return Promise.reject(
        new DataError('invalid_options', 'onUpdate is required.'),
      );
    if (options.signal?.aborted) return Promise.reject(cancelled());
    if (this.items.has(key))
      return Promise.reject(
        new DataError(
          'duplicate_subscription',
          'This stream already has a local subscription.',
        ),
      );
    if (this.items.size >= 100)
      return Promise.reject(
        new DataError(
          'subscription_limit',
          'At most 100 subscriptions are supported.',
        ),
      );
    return new Promise<Unsubscribe>((resolve, reject) => {
      const item: Subscription<T> = {
        key,
        spec,
        options: { ...options },
        active: true,
        settled: false,
        sequence: -1,
        resolve,
        reject,
        cancel: (): void => this.remove(item, cancelled()),
        timer: setTimeout(
          () =>
            this.remove(
              item,
              new DataError(
                'subscription_timeout',
                'Data subscription setup timed out.',
                true,
              ),
              true,
            ),
          this.connection.subscriptionTimeoutMs,
        ),
      };
      options.signal?.addEventListener('abort', item.cancel, { once: true });
      item.detach = (): void =>
        options.signal?.removeEventListener('abort', item.cancel);
      this.items.set(item.key, item);
      this.connection.start();
      if (this.connection.getSnapshot().status === 'connected')
        this.register(item);
    });
  }

  private register(item: Subscription<T>): void {
    const version = this.connection.getSnapshot().connectionVersion;
    if (!item.active || item.version === version) return;
    item.version = version;
    void this.connection
      .request(item.spec.method, item.spec.params, readSubscriptionId, {
        resource: true,
        isRelevant: (): boolean => item.active,
        onResult: (id): void => {
          if (!item.active) {
            this.releaseRemote(id, version, item.spec.unsubscribe);
            return;
          }
          if (this.remote.has(id)) throw invalidResponse();
          item.serverId = id;
          item.sequence = -1;
          this.remote.set(id, item);
          if (!item.settled) {
            item.settled = true;
            clearTimeout(item.timer);
            item.resolve(item.cancel);
          }
          if (item.options.onSubscribed)
            safely(() => item.options.onSubscribed!(id));
        },
      })
      .catch((error: unknown) => {
        if (!item.active) return;
        const state = this.connection.getSnapshot();
        // Socket loss restores registrations on the next authenticated connection.
        if (state.status !== 'connected' || state.connectionVersion !== version)
          return;
        this.remove(
          item,
          error instanceof DataError ? error : invalidResponse(),
          true,
        );
      });
  }

  receive(message: Record<string, unknown>): void {
    if (
      ![...this.items.values()].some(
        (item) => item.spec.notification === message.method,
      )
    )
      return;
    const params = message.params;
    if (!record(params) || typeof params.subscription !== 'string')
      throw invalidResponse();
    const item = this.remote.get(params.subscription);
    if (!item || !item.active || message.method !== item.spec.notification)
      return;
    if (
      typeof params.sequence !== 'number' ||
      !Number.isSafeInteger(params.sequence) ||
      params.sequence < 0
    )
      throw invalidResponse();
    if (params.sequence <= item.sequence) return;
    if ('error' in params && item.spec.slot) {
      if (
        'result' in params ||
        !record(params.error) ||
        params.error.code !== -32010 ||
        typeof params.error.message !== 'string'
      )
        throw invalidResponse();
      item.sequence = params.sequence;
      const message = params.error.message;
      if (item.options.onUnavailable)
        safely(() =>
          item.options.onUnavailable!(new DataError(-32010, message, true)),
        );
      return;
    }
    const value = item.spec.parse(params.result);
    item.sequence = params.sequence;
    const slot = item.spec.slot?.(value);
    if (slot !== undefined && item.slot !== undefined && slot < item.slot)
      return;
    item.slot = slot;
    item.sequence = params.sequence;
    safely(() => item.options.onUpdate(value));
  }

  close(error = new DataError('closed', 'Data client closed.')): void {
    for (const item of [...this.items.values()])
      this.remove(item, error, error.code !== 'closed');
  }

  private remove(
    item: Subscription<T>,
    error: DataError,
    report = false,
  ): void {
    if (!item.active) return;
    item.active = false;
    this.items.delete(item.key);
    item.detach?.();
    clearTimeout(item.timer);
    if (!item.settled) {
      item.settled = true;
      item.reject(error);
    }
    if (item.serverId) {
      this.remote.delete(item.serverId);
      this.releaseRemote(item.serverId, item.version!, item.spec.unsubscribe);
    }
    if (report && item.options.onError)
      safely(() => item.options.onError!(error));
  }

  private releaseRemote(id: string, version: number, method: string): void {
    const state = this.connection.getSnapshot();
    if (state.status !== 'connected' || state.connectionVersion !== version)
      return;
    void this.connection
      .request(
        method,
        { subscription: id },
        (value): boolean => {
          if (typeof value !== 'boolean') throw invalidResponse();
          return value;
        },
        { resource: true },
      )
      .catch(() => {
        // If release is uncertain, close the session to release its resources.
        if (
          this.connection.getSnapshot().status === 'connected' &&
          this.connection.getSnapshot().connectionVersion === version
        )
          this.connection.recover(
            new DataError(
              'unsubscribe_failed',
              'Could not release remote subscription.',
              true,
            ),
          );
      });
  }
}
