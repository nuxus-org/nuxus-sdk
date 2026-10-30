import { DataError, type TokenSupplier } from './types.js';
import { cancelled } from './protocol.js';

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = (): void => reject(cancelled());
    if (signal.aborted) reject(cancelled());
    else signal.addEventListener('abort', abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function obtainToken(
  supplier: TokenSupplier,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw cancelled();
  let value: string;
  try {
    value = await abortable(
      Promise.resolve().then(() => {
        if (signal.aborted) throw cancelled();
        return supplier({ signal });
      }),
      signal,
    );
  } catch {
    throw signal.aborted
      ? cancelled()
      : new DataError('token_error', 'Could not obtain a data token.');
  }
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 8192 ||
    /[\s,]/.test(value)
  )
    throw new DataError(
      'token_error',
      'Token supplier must return a valid data token string.',
    );
  return value;
}
