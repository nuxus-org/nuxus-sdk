import { EngineError } from './errors.js';
import { MAX_TIMEOUT_MS } from './constants.js';

export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const disconnected = (): EngineError =>
  new EngineError('disconnected', 'Engine connection is not available.');
export const invalidMessage = (): EngineError =>
  new EngineError('invalid_message', 'Invalid JSON-RPC engine message.');

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
    // Supplied URLs may contain credentials; keep them out of errors.
  }
  throw new EngineError(
    'invalid_url',
    'Use an engine endpoint without credentials, query or fragment.',
    false,
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
    value > MAX_TIMEOUT_MS
  )
    throw new EngineError('invalid_options', `Invalid ${name}.`, false);
  return value;
}

export function safely(callback: () => void): void {
  try {
    callback();
  } catch {
    // Application callbacks cannot interrupt the connection lifecycle.
  }
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void =>
      reject(new EngineError('aborted', 'Operation cancelled.', false));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
