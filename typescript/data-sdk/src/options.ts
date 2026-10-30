import { DataError, type DataClientOptions, type DataSocket } from './types.js';
import { duration, validateUrl } from './protocol.js';

export function resolveOptions(
  options: DataClientOptions,
): Required<DataClientOptions> {
  const url = validateUrl(options.url, ['ws:', 'wss:']);
  if (typeof options.getToken !== 'function')
    throw new DataError('invalid_options', 'getToken is required.');
  const resolved: Required<DataClientOptions> = {
    connectionTimeoutMs: options.connectionTimeoutMs ?? 15_000,
    requestTimeoutMs: options.requestTimeoutMs ?? 15_000,
    subscriptionTimeoutMs: options.subscriptionTimeoutMs ?? 30_000,
    reconnectMinDelayMs: options.reconnectMinDelayMs ?? 1000,
    reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? 30_000,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 30_000,
    requestsPerSecond: options.requestsPerSecond ?? 10,
    createWebSocket:
      options.createWebSocket ??
      ((address): DataSocket => new WebSocket(address)),
    getToken: options.getToken,
    url,
  };
  for (const key of [
    'connectionTimeoutMs',
    'requestTimeoutMs',
    'subscriptionTimeoutMs',
    'reconnectMinDelayMs',
    'reconnectMaxDelayMs',
    'heartbeatIntervalMs',
  ] as const)
    duration(resolved[key], key, key === 'heartbeatIntervalMs');
  if (
    resolved.reconnectMaxDelayMs < resolved.reconnectMinDelayMs ||
    !Number.isInteger(resolved.requestsPerSecond) ||
    resolved.requestsPerSecond < 1 ||
    resolved.requestsPerSecond > 1000
  )
    throw new DataError(
      'invalid_options',
      'Invalid reconnect delays or requestsPerSecond.',
    );
  return resolved;
}
