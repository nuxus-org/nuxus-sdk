import { EngineError } from './errors.js';
import { MAX_BATCH_SIZE, MAX_PENDING_REQUESTS } from './constants.js';
import { disconnected, invalidMessage, record } from './protocol.js';
import type { EngineConnection } from './connection.js';
import type { BatchResult, EngineRequest } from './types.js';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: EngineError) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class RequestManager {
  private readonly pending = new Map<string, Pending>();
  private counter = 0;

  constructor(
    private readonly connection: EngineConnection,
    private readonly onSettled: (generation: number) => void,
  ) {}

  get capacity(): number {
    return MAX_PENDING_REQUESTS - this.pending.size;
  }

  nextId(): string {
    return `sdk-${++this.counter}`;
  }

  clear(error: EngineError): void {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
  }

  async request<T = unknown>(
    input: EngineRequest,
    minimumTimeoutMs = 0,
  ): Promise<T> {
    const request = structuredClone(input);
    await this.connection.ready();
    return this.send(
      {
        method: request.method,
        params: request.params,
      },
      undefined,
      undefined,
      Math.max(this.connection.options.requestTimeoutMs, minimumTimeoutMs),
    ) as Promise<T>;
  }

  async batch<T = unknown>(
    requests: EngineRequest[],
  ): Promise<BatchResult<T>[]> {
    if (!requests.length || requests.length > MAX_BATCH_SIZE)
      throw new EngineError(
        'invalid_batch',
        'Provide 1 to 32 requests.',
        false,
      );
    const inputs = structuredClone(requests);
    await this.connection.ready();
    if (this.pending.size + inputs.length > MAX_PENDING_REQUESTS)
      throw new EngineError(
        'request_limit',
        'At most 32 requests can be pending.',
      );
    const frames: Record<string, unknown>[] = [];
    const promises = inputs.map(
      (input) =>
        this.send(
          { method: input.method, params: input.params },
          undefined,
          frames,
        ) as Promise<T>,
    );
    // Install all pending handlers before sending; synchronous transports are supported.
    const result = Promise.allSettled(promises);
    this.connection.send(JSON.stringify(frames));
    return result;
  }

  send(
    fields: Record<string, unknown>,
    onResult?: (value: unknown) => void,
    batch?: Record<string, unknown>[],
    timeoutMs = this.connection.options.requestTimeoutMs,
  ): Promise<unknown> {
    if (!this.connection.connected) return Promise.reject(disconnected());
    if (this.pending.size >= MAX_PENDING_REQUESTS)
      return Promise.reject(
        new EngineError('request_limit', 'At most 32 requests can be pending.'),
      );
    const requestId = this.nextId();
    const generation = this.connection.version;
    return new Promise((resolve, reject) => {
      let payload: string;
      try {
        payload = JSON.stringify({ jsonrpc: '2.0', ...fields, id: requestId });
      } catch {
        reject(
          new EngineError(
            'invalid_request',
            'Request must be JSON serializable.',
            false,
          ),
        );
        return;
      }
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new EngineError('request_timeout', 'Engine request timed out.'));
        queueMicrotask(() => this.onSettled(generation));
      }, timeoutMs);
      this.pending.set(requestId, {
        resolve: (value) => {
          try {
            onResult?.(value);
            resolve(value);
          } catch (error) {
            reject(
              error instanceof Error
                ? error
                : new EngineError(
                    'invalid_response',
                    'Could not process the engine response.',
                  ),
            );
          }
        },
        reject,
        timer,
      });
      if (batch) {
        batch.push(JSON.parse(payload) as Record<string, unknown>);
        return;
      }
      this.connection.send(payload);
    });
  }

  receive(message: Record<string, unknown>, generation: number): void {
    const invalid = (): void =>
      this.connection.fail(generation, invalidMessage());
    if (
      typeof message.id !== 'string' ||
      'method' in message ||
      'result' in message === 'error' in message
    ) {
      invalid();
      return;
    }
    const error = message.error;
    if (
      'error' in message &&
      (!record(error) ||
        typeof error.code !== 'number' ||
        !Number.isInteger(error.code) ||
        typeof error.message !== 'string')
    ) {
      invalid();
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (record(error))
      pending.reject(
        new EngineError(
          error.code as number,
          error.message as string,
          false,
          error.data,
        ),
      );
    else pending.resolve(message.result);
    queueMicrotask(() => this.onSettled(generation));
  }
}
