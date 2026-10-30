import type { EngineError } from '../errors.js';

export type ConnectionStatus =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'stopped';

export interface ConnectionSnapshot {
  readonly status: ConnectionStatus;
  readonly connectionId: string | null;
  readonly error: EngineError | null;
}

export type EngineSocket = Pick<
  WebSocket,
  'readyState' | 'onmessage' | 'onerror' | 'onclose' | 'send' | 'close'
>;

export interface EngineConnectionOptions {
  url: string;
  createWebSocket?: (url: string, protocols: string[]) => EngineSocket;
  connectionTimeoutMs?: number;
  requestTimeoutMs?: number;
  reconnectMinDelayMs?: number;
  reconnectMaxDelayMs?: number;
  heartbeatIntervalMs?: number;
}

export type EngineClientOptions = EngineConnectionOptions;

export interface EngineHttpClientOptions {
  /** HTTP engine endpoint; normally https://engine.example/ */
  url: string;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
}

export type EngineQueryMethod =
  | 'engine.ping'
  | 'solana.pump.getLaunchOptions'
  | 'solana.pump.getTokenSettings'
  | 'solana.pump.getCharityConfig';

export interface EngineQueryRequest extends EngineRequest {
  method: EngineQueryMethod;
}

export interface EngineRequest {
  method: string;
  params?: Record<string, unknown> | unknown[];
}

export type Unsubscribe = () => void;

export interface SubscriptionOptions<T> {
  /** Live values and snapshots when enabled by the subscription. */
  onUpdate: (value: T) => void;
  onError?: (error: EngineError) => void;
  /** Called after each subscription acknowledgement, including reconnects. */
  onSubscribed?: () => void;
  /** Coalesce subscription setup calls into JSON-RPC batches (up to 32). */
  batch?: boolean;
  /** Cancels setup or an active subscription; useful for component cleanup. */
  signal?: AbortSignal;
}

export interface EngineSubscription {
  /** Release local state after the first notification. */
  once?: boolean;
  method: string;
  notification: string;
  unsubscribe: string;
  params?: Record<string, unknown>;
}

export type BatchResult<T = unknown> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: EngineError };
