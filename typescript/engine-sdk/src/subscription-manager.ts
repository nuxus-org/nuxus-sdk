import { EngineError } from './errors.js';
import {
  MAX_CONCURRENT_SUBSCRIPTIONS,
  MAX_SUBSCRIPTIONS,
  MAX_TIMEOUT_MS,
} from './constants.js';
import { invalidMessage, record, safely } from './protocol.js';
import type { EngineConnection } from './connection.js';
import type { RequestManager } from './request-manager.js';
import type {
  EngineSubscription,
  SubscriptionOptions,
  Unsubscribe,
} from './types.js';

type Subscription = {
  key: string;
  input: EngineSubscription;
  handlers: SubscriptionOptions<unknown>;
  serverId?: string;
  sequence: number;
  active: boolean;
  settle: (error?: EngineError) => void;
  cancel: Unsubscribe;
  detach?: () => void;
};

export class SubscriptionManager {
  private readonly subscriptions = new Map<string, Subscription>();
  private readonly serverSubscriptions = new Map<string, Subscription>();
  private subscriptionQueue: Subscription[] = [];
  private readonly scheduledSubscriptions = new Set<Subscription>();
  private subscriptionSetups = 0;

  constructor(
    private readonly connection: EngineConnection,
    private readonly requests: RequestManager,
  ) {}

  restore(generation: number): void {
    for (const item of this.subscriptions.values())
      this.enqueueSubscription(item, generation);
  }

  reset(): void {
    this.serverSubscriptions.clear();
    for (const item of this.subscriptions.values()) {
      item.serverId = undefined;
      item.sequence = -1;
    }
    this.subscriptionQueue = [];
    this.scheduledSubscriptions.clear();
    this.subscriptionSetups = 0;
  }

  close(error: EngineError, report: boolean): void {
    for (const item of [...this.subscriptions.values()]) {
      item.active = false;
      item.detach?.();
      item.settle(error);
      if (report) safely(() => item.handlers.onError?.(error));
    }
    this.subscriptions.clear();
  }

  subscribe<T>(
    input: EngineSubscription,
    handlers: SubscriptionOptions<T>,
  ): Promise<Unsubscribe> {
    if (handlers.signal?.aborted)
      return Promise.reject(
        new EngineError('aborted', 'Subscription cancelled.', false),
      );
    if (this.subscriptions.size >= MAX_SUBSCRIPTIONS)
      return Promise.reject(
        new EngineError(
          'subscription_limit',
          'At most 100 subscriptions are supported.',
          false,
        ),
      );
    const cloned = structuredClone(input);
    return new Promise((resolve, reject) => {
      let settled = false;
      const item: Subscription = {
        key: this.requests.nextId(),
        input: cloned,
        handlers: handlers as SubscriptionOptions<unknown>,
        sequence: -1,
        active: true,
        cancel: () => {
          if (!item.active) return;
          item.active = false;
          this.subscriptions.delete(item.key);
          item.detach?.();
          item.settle(
            new EngineError('aborted', 'Subscription cancelled.', false),
          );
          if (item.serverId) {
            this.serverSubscriptions.delete(item.serverId);
            this.removeRemoteSubscription(
              item,
              item.serverId,
              this.connection.version,
            );
          }
        },
        settle: (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (error) reject(error);
          else resolve(item.cancel);
        },
      };
      const timer = setTimeout(
        () => {
          item.settle(
            new EngineError(
              'subscription_timeout',
              'Subscription setup timed out.',
            ),
          );
          item.cancel();
        },
        Math.min(
          MAX_TIMEOUT_MS,
          this.connection.options.connectionTimeoutMs +
            this.connection.options.requestTimeoutMs,
        ),
      );
      if (handlers.signal) {
        handlers.signal.addEventListener('abort', item.cancel, { once: true });
        item.detach = (): void =>
          handlers.signal?.removeEventListener('abort', item.cancel);
      }
      this.subscriptions.set(item.key, item);
      this.connection.start();
      if (this.connection.getSnapshot().status === 'connected')
        this.enqueueSubscription(item, this.connection.version);
    });
  }

  receive(message: Record<string, unknown>, generation: number): void {
    const invalid = (): void =>
      this.connection.fail(generation, invalidMessage());
    const params = message.params;
    if (
      typeof message.method !== 'string' ||
      !record(params) ||
      typeof params.subscription !== 'string' ||
      typeof params.sequence !== 'number' ||
      !Number.isSafeInteger(params.sequence) ||
      params.sequence < 0 ||
      !('result' in params)
    ) {
      invalid();
      return;
    }
    const item = this.serverSubscriptions.get(params.subscription);
    if (
      !item?.active ||
      item.input.notification !== message.method ||
      params.sequence <= item.sequence
    )
      return;
    item.sequence = params.sequence;
    if (item.input.once) {
      // The server releases one-shot subscriptions with the notification.
      item.active = false;
      this.subscriptions.delete(item.key);
      this.serverSubscriptions.delete(params.subscription);
      item.detach?.();
    }
    safely(() => item.handlers.onUpdate(params.result));
  }

  private enqueueSubscription(item: Subscription, generation: number): void {
    if (
      !this.connection.current(generation) ||
      this.scheduledSubscriptions.has(item)
    )
      return;
    this.scheduledSubscriptions.add(item);
    this.subscriptionQueue.push(item);
    queueMicrotask(() => this.drain(generation));
  }

  drain(generation: number): void {
    while (
      this.connection.current(generation) &&
      this.subscriptionSetups < MAX_CONCURRENT_SUBSCRIPTIONS
    ) {
      const item = this.subscriptionQueue.shift();
      if (!item) return;
      if (!item.active || item.serverId) {
        this.scheduledSubscriptions.delete(item);
        continue;
      }
      if (item.handlers.batch) {
        const capacity = this.requests.capacity;
        if (capacity <= 0) {
          this.subscriptionQueue.unshift(item);
          return;
        }
        const items = [item];
        while (
          items.length < capacity &&
          this.subscriptionQueue[0]?.handlers.batch
        ) {
          const next = this.subscriptionQueue.shift()!;
          if (next.active && !next.serverId) items.push(next);
          else this.scheduledSubscriptions.delete(next);
        }
        const frames: Record<string, unknown>[] = [];
        this.subscriptionSetups += items.length;
        // setupSubscription registers response handlers synchronously before send.
        const work = items.map((entry) =>
          this.setupSubscription(entry, generation, frames),
        );
        void Promise.all(work).finally(() => {
          if (!this.connection.current(generation)) return;
          this.subscriptionSetups -= items.length;
          for (const entry of items) this.scheduledSubscriptions.delete(entry);
          this.drain(generation);
        });
        this.connection.send(JSON.stringify(frames));
        continue;
      }
      this.subscriptionSetups++;
      void this.setupSubscription(item, generation).finally(() => {
        // Old connection completions must not release a new connection's slots.
        if (!this.connection.current(generation)) return;
        this.subscriptionSetups--;
        this.scheduledSubscriptions.delete(item);
        this.drain(generation);
      });
    }
  }

  private async setupSubscription(
    item: Subscription,
    generation: number,
    batch?: Record<string, unknown>[],
  ): Promise<void> {
    try {
      await this.requests.send(
        { method: item.input.method, params: item.input.params },
        (result) => {
          if (typeof result !== 'string' || !result.length)
            throw new EngineError(
              'invalid_subscription',
              'Invalid subscription ID.',
            );
          if (!this.connection.current(generation)) return;
          if (!item.active) {
            this.removeRemoteSubscription(item, result, generation);
            return;
          }
          // Bind the remote ID before a notification in the same frame is dispatched.
          item.serverId = result;
          item.sequence = -1;
          this.serverSubscriptions.set(result, item);
          item.settle();
          safely(() => item.handlers.onSubscribed?.());
        },
        batch,
      );
    } catch (cause) {
      if (!this.connection.current(generation)) return;
      const error =
        cause instanceof EngineError
          ? cause
          : new EngineError('subscription_failed', 'Subscription failed.');
      if (item.active) {
        item.settle(error);
        safely(() => item.handlers.onError?.(error));
        item.cancel();
      }
      if (
        error.code === 'request_timeout' ||
        error.code === 'invalid_subscription'
      )
        this.connection.fail(generation, error);
    }
  }

  private removeRemoteSubscription(
    item: Subscription,
    subscription: string,
    generation: number,
  ): void {
    if (!this.connection.current(generation)) return;
    void this.requests
      .send({
        method: item.input.unsubscribe,
        params: { subscription },
      })
      .catch(() => {
        this.connection.fail(
          generation,
          new EngineError(
            'unsubscribe_failed',
            'Could not release the engine subscription.',
          ),
        );
      });
  }
}
