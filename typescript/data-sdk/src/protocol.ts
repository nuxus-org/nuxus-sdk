import { DataError } from './types.js';

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const invalidResponse = (): DataError =>
  new DataError('invalid_response', 'Invalid data gateway response.');
export const cancelled = (): DataError =>
  new DataError('aborted', 'Operation cancelled.');
export const disconnected = (): DataError =>
  new DataError('disconnected', 'Data connection lost.', true);

export function validateUrl(value: string, protocols: string[]): string {
  try {
    const url = new URL(value);
    if (
      protocols.includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
      return url.href;
  } catch {
    /* Do not include the supplied URL in errors. */
  }
  throw new DataError(
    'invalid_url',
    'Use a data endpoint without credentials, query or fragment.',
  );
}
export function duration(
  value: number,
  name: string,
  allowZero = false,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 2_147_483_647
  )
    throw new DataError('invalid_options', `Invalid ${name}.`);
  return value;
}
export function readSubscriptionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw invalidResponse();
  return value;
}
export function readPong(value: unknown): 'pong' {
  if (value !== 'pong') throw invalidResponse();
  return value;
}
export function responseResult(
  message: unknown,
  id: string,
  authentication = false,
): unknown {
  if (
    !record(message) ||
    message.jsonrpc !== '2.0' ||
    message.id !== id ||
    'result' in message === 'error' in message
  )
    throw invalidResponse();
  if ('error' in message) {
    const error = message.error;
    if (
      !record(error) ||
      !Number.isSafeInteger(error.code) ||
      typeof error.message !== 'string'
    )
      throw invalidResponse();
    const code = error.code as number;
    throw new DataError(
      code,
      authentication ? 'Data authentication failed.' : error.message,
      [-32002, -32003, -32004].includes(code),
      authentication ? undefined : error.data,
    );
  }
  return message.result;
}
export function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    /* Application callbacks cannot break the transport. */
  }
}
