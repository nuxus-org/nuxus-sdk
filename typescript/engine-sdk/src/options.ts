import { EngineError } from './errors.js';
import { duration, validateUrl } from './protocol.js';
import type { EngineClientOptions, EngineSocket } from './types.js';

export function resolveOptions(
  input: EngineClientOptions,
): Required<EngineClientOptions> {
  validateUrl(input.url, ['ws:', 'wss:']);
  const options: Required<EngineClientOptions> = {
    url: input.url,
    createWebSocket:
      input.createWebSocket ??
      ((url, protocols): EngineSocket => new WebSocket(url, protocols)),
    connectionTimeoutMs: input.connectionTimeoutMs ?? 15_000,
    requestTimeoutMs: input.requestTimeoutMs ?? 15_000,
    reconnectMinDelayMs: input.reconnectMinDelayMs ?? 1_000,
    reconnectMaxDelayMs: input.reconnectMaxDelayMs ?? 30_000,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 30_000,
  };
  for (const key of [
    'connectionTimeoutMs',
    'requestTimeoutMs',
    'reconnectMinDelayMs',
    'reconnectMaxDelayMs',
    'heartbeatIntervalMs',
  ] as const)
    duration(options[key], key, key === 'heartbeatIntervalMs');
  if (typeof options.createWebSocket !== 'function')
    throw new EngineError(
      'invalid_options',
      'createWebSocket must be a function.',
      false,
    );
  if (options.reconnectMaxDelayMs < options.reconnectMinDelayMs)
    throw new EngineError(
      'invalid_options',
      'Maximum reconnect delay must be at least the minimum delay.',
      false,
    );
  return options;
}
