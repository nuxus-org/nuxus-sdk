import { prepareQuery } from './queries.js';
import type {
  PumpfunGetParams,
  PumpfunCalloutsResult,
} from './pumpfun.contracts.js';
import { abortable, obtainToken } from './authentication.js';
import type {
  NativeBalancesOptions,
  TokenBalancesOptions,
  NativeBalancesResult,
  TokenBalancesResult,
} from './solana.contracts.js';
import type {
  BinancePriceParams,
  BinancePriceSnapshot,
  DataQuery,
  DataQueryResult,
} from './contracts.js';
import {
  duration,
  invalidResponse,
  record,
  responseResult,
  validateUrl,
} from './protocol.js';
import {
  DataError,
  type BatchResult,
  type DataHttpClientOptions,
  type RequestOptions,
} from './types.js';

/** Bearer-authenticated queries; no socket and no automatic request retries. */
export class DataHttpClient {
  private readonly url: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private counter = 0;

  constructor(private readonly options: DataHttpClientOptions) {
    this.url = validateUrl(options.url, ['http:', 'https:']);
    if (typeof options.getToken !== 'function')
      throw new DataError('invalid_options', 'getToken is required.');
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = duration(
      options.requestTimeoutMs ?? 15_000,
      'requestTimeoutMs',
    );
  }

  ping(options?: RequestOptions): Promise<'pong'> {
    return this.request({ method: 'ping' }, options);
  }
  readonly binance = {
    getPrice: (
      params: BinancePriceParams,
      options?: RequestOptions,
    ): Promise<BinancePriceSnapshot> =>
      this.request({ method: 'binance.getPrice', params }, options),
  };

  readonly pumpfun = {
    getCallouts: (
      params?: PumpfunGetParams,
      options?: RequestOptions,
    ): Promise<PumpfunCalloutsResult> =>
      this.request({ method: 'pumpfun.getCallouts', params }, options),
  };
  readonly solana = {
    getNativeBalances: (
      params: NativeBalancesOptions,
      options?: RequestOptions,
    ): Promise<NativeBalancesResult> =>
      this.request({ method: 'solana.getNativeBalances', params }, options),
    getTokenBalances: (
      params: TokenBalancesOptions,
      options?: RequestOptions,
    ): Promise<TokenBalancesResult> =>
      this.request({ method: 'solana.getTokenBalances', params }, options),
  };

  request(
    input: Extract<DataQuery, { method: 'pumpfun.getCallouts' }>,
    options?: RequestOptions,
  ): Promise<PumpfunCalloutsResult>;
  request(
    input: Extract<DataQuery, { method: 'ping' }>,
    options?: RequestOptions,
  ): Promise<'pong'>;
  request(
    input: Extract<DataQuery, { method: 'solana.getNativeBalances' }>,
    options?: RequestOptions,
  ): Promise<NativeBalancesResult>;
  request(
    input: Extract<DataQuery, { method: 'solana.getTokenBalances' }>,
    options?: RequestOptions,
  ): Promise<TokenBalancesResult>;
  request(
    input: Extract<DataQuery, { method: 'binance.getPrice' }>,
    options?: RequestOptions,
  ): Promise<BinancePriceSnapshot>;
  request(input: DataQuery, options?: RequestOptions): Promise<DataQueryResult>;
  async request(
    input: DataQuery,
    options: RequestOptions = {},
  ): Promise<DataQueryResult> {
    const query = prepareQuery(input);
    const id = `http-${++this.counter}`;
    const response = await this.post(
      {
        jsonrpc: '2.0',
        id,
        method: query.method,
        ...(query.params ? { params: query.params } : {}),
      },
      options.signal,
    );
    return query.parse(responseResult(response, id));
  }

  async batch(
    inputs: DataQuery[],
    options: RequestOptions = {},
  ): Promise<BatchResult<DataQueryResult>[]> {
    if (inputs.length < 1 || inputs.length > 32)
      throw new DataError('invalid_batch', 'Provide 1 to 32 data queries.');
    const queries = inputs.map((input) => ({
      ...prepareQuery(input),
      id: `http-${++this.counter}`,
    }));
    const response = await this.post(
      queries.map((query) => ({
        jsonrpc: '2.0',
        id: query.id,
        method: query.method,
        ...(query.params ? { params: query.params } : {}),
      })),
      options.signal,
    );
    if (!Array.isArray(response) || response.length !== queries.length)
      throw invalidResponse();
    const byId = new Map<string, unknown>();
    for (const item of response) {
      if (
        !record(item) ||
        typeof item.id !== 'string' ||
        byId.has(item.id) ||
        !queries.some((query) => query.id === item.id)
      )
        throw invalidResponse();
      byId.set(item.id, item);
    }
    return queries.map((query): BatchResult<DataQueryResult> => {
      try {
        return {
          status: 'fulfilled',
          value: query.parse(responseResult(byId.get(query.id), query.id)),
        };
      } catch (error) {
        return {
          status: 'rejected',
          reason: error instanceof DataError ? error : invalidResponse(),
        };
      }
    });
  }

  private async post(body: unknown, signal?: AbortSignal): Promise<unknown> {
    const abort = new AbortController();
    const cancel = (): void => abort.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, this.timeoutMs);
    try {
      const token = await obtainToken(this.options.getToken, abort.signal);
      const response = await abortable(
        this.fetcher(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: abort.signal,
          credentials: 'omit',
          redirect: 'error',
          cache: 'no-store',
        }),
        abort.signal,
      );
      if (!response.ok)
        throw new DataError(
          response.status === 401 ? 'unauthorized' : 'http_error',
          `Data HTTP request failed (${response.status}).`,
          response.status >= 500 || response.status === 429,
        );
      return await abortable(response.json() as Promise<unknown>, abort.signal);
    } catch (error) {
      if (abort.signal.aborted)
        throw new DataError(
          signal?.aborted ? 'aborted' : 'request_timeout',
          'Data HTTP request cancelled or timed out.',
        );
      if (error instanceof DataError) throw error;
      throw new DataError(
        'http_error',
        'Could not complete the data HTTP request.',
        true,
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }
}

export function createHttpClient(
  options: DataHttpClientOptions,
): DataHttpClient {
  return new DataHttpClient(options);
}
