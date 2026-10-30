import {
  EngineError,
  type BatchResult,
  type EngineHttpClientOptions,
  type EngineQueryRequest,
} from './types.js';
import { abortable, duration, record, validateUrl } from './protocol.js';
import { MAX_BATCH_SIZE } from './constants.js';

/** Query-only JSON-RPC over HTTP. Does not open a WebSocket or retry requests. */
export class EngineHttpClient {
  private readonly url: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private counter = 0;

  constructor(options: EngineHttpClientOptions) {
    this.url = validateUrl(options.url, ['http:', 'https:']);
    this.timeoutMs = duration(
      options.requestTimeoutMs ?? 15_000,
      'requestTimeoutMs',
    );
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  readonly engine = {
    ping: (): Promise<{ connectionId: string; serverTimeMs: number }> =>
      this.request({ method: 'engine.ping' }),
  };

  async request<T = unknown>(
    input: EngineQueryRequest,
    options: { signal?: AbortSignal } = {},
  ): Promise<T> {
    const call = this.call(input);
    const response = await this.post(call, options.signal);
    return this.result(response, call.id) as T;
  }

  async batch<T = unknown>(
    inputs: EngineQueryRequest[],
    options: { signal?: AbortSignal } = {},
  ): Promise<BatchResult<T>[]> {
    if (inputs.length < 1 || inputs.length > MAX_BATCH_SIZE)
      throw new EngineError('invalid_batch', 'Provide 1 to 32 queries.', false);
    const calls = inputs.map((input) => this.call(input));
    const response = await this.post(calls, options.signal);
    if (!Array.isArray(response) || response.length !== calls.length)
      throw this.invalidResponse();
    const byId = new Map<string, unknown>();
    for (const item of response) {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        byId.has(item.id) ||
        !calls.some((call) => call.id === item.id)
      )
        throw this.invalidResponse();
      byId.set(item.id, item);
    }
    return calls.map((call): BatchResult<T> => {
      try {
        return {
          status: 'fulfilled',
          value: this.result(byId.get(call.id), call.id) as T,
        };
      } catch (error) {
        return {
          status: 'rejected',
          reason: error instanceof EngineError ? error : this.invalidResponse(),
        };
      }
    });
  }

  private call(input: EngineQueryRequest): {
    jsonrpc: '2.0';
    id: string;
    method: string;
    params?: Record<string, unknown> | unknown[];
  } {
    if (
      ![
        'engine.ping',
        'solana.pump.getLaunchOptions',
        'solana.pump.getTokenSettings',
        'solana.pump.getCharityConfig',
      ].includes(input.method)
    ) {
      throw new EngineError(
        'unsupported_method',
        'HTTP supports only explicitly allowed read methods. Use WebSocket for writes and subscriptions.',
        false,
      );
    }
    return {
      jsonrpc: '2.0',
      id: `http-${++this.counter}`,
      method: input.method,
      ...(input.params === undefined
        ? {}
        : { params: structuredClone(input.params) }),
    };
  }

  private result(response: unknown, id: string): unknown {
    if (
      !record(response) ||
      response.jsonrpc !== '2.0' ||
      response.id !== id ||
      'result' in response === 'error' in response
    )
      throw this.invalidResponse();
    if ('error' in response) {
      const error = response.error;
      if (
        !record(error) ||
        !Number.isInteger(error.code) ||
        typeof error.message !== 'string'
      )
        throw this.invalidResponse();
      throw new EngineError(
        error.code as number,
        error.message,
        false,
        error.data,
      );
    }
    return response.result;
  }

  private invalidResponse(): EngineError {
    return new EngineError(
      'invalid_response',
      'Invalid engine JSON-RPC response.',
      false,
    );
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<unknown> {
    const abort = new AbortController();
    const cancel = (): void => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      if (abort.signal.aborted)
        throw new EngineError('aborted', 'Operation cancelled.', false);
      const response = await abortable(
        this.fetcher(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: abort.signal,
          redirect: 'error',
          credentials: 'omit',
          cache: 'no-store',
        }),
        abort.signal,
      );
      if (!response.ok)
        throw new EngineError(
          'http_error',
          `Engine HTTP request failed (${response.status}).`,
          response.status >= 500,
        );
      return await abortable(response.json() as Promise<unknown>, abort.signal);
    } catch (error) {
      if (abort.signal.aborted)
        throw new EngineError(
          signal?.aborted ? 'aborted' : 'request_timeout',
          'Engine HTTP request was cancelled or timed out.',
          false,
        );
      if (error instanceof EngineError) throw error;
      throw new EngineError(
        'http_error',
        'Could not complete the engine HTTP request.',
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}

export function createHttpClient(
  options: EngineHttpClientOptions,
): EngineHttpClient {
  return new EngineHttpClient(options);
}
