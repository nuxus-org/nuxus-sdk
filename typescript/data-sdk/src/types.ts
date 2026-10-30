import type { BinancePriceParams, BinancePriceSnapshot } from './contracts.js';

export class DataError extends Error {
  constructor(
    readonly code: string | number,
    message: string,
    readonly retryable = false,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'DataError';
  }
}
export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'authenticating'
  | 'connected'
  | 'reconnecting'
  | 'stopped';
export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  /** Local counter incremented after each successful authentication, not a server ID. */
  readonly connectionVersion: number;
  readonly error: DataError | null;
}
export type TokenSupplier = (context: {
  signal: AbortSignal;
}) => string | Promise<string>;
export type DataSocket = Pick<
  WebSocket,
  | 'readyState'
  | 'onopen'
  | 'onmessage'
  | 'onerror'
  | 'onclose'
  | 'send'
  | 'close'
>;
export interface DataClientOptions {
  url: string;
  /** Called before every new WebSocket connection. Return a valid data JWT. */
  getToken: TokenSupplier;
  createWebSocket?: (url: string) => DataSocket;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  subscriptionTimeoutMs?: number;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
  /** Local rolling-window budget. The server's account-wide budget still applies. */
  requestsPerSecond?: number;
}
export interface DataHttpClientOptions {
  url: string;
  getToken: TokenSupplier;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}
export interface RequestOptions {
  signal?: AbortSignal;
}
export type Unsubscribe = () => void;
export interface SubscriptionOptions<T> {
  onUpdate(snapshot: T): void;
  onError?(error: DataError): void;
  /** Temporary upstream failure; subscription stays registered and recovers. */
  onUnavailable?(error: DataError): void;
  /** Called for each acknowledged registration, including reconnects. */
  onSubscribed?(subscription: string): void;
  signal?: AbortSignal;
}
export interface BinanceSubscriptionOptions
  extends BinancePriceParams, SubscriptionOptions<BinancePriceSnapshot> {}
export type BatchResult<T> =
  { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: DataError };
