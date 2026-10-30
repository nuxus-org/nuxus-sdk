import type { BinancePriceSnapshot } from './contracts.js';
import { DataError } from './types.js';
import { invalidResponse, record } from './protocol.js';

export function validateStream(stream: string): void {
  if (typeof stream !== 'string' || !/^[a-z0-9]{2,40}@miniTicker$/.test(stream))
    throw new DataError(
      'invalid_params',
      'Expected a lowercase Binance <symbol>@miniTicker stream.',
    );
}

export function readPrice(
  value: unknown,
  stream: string,
): BinancePriceSnapshot {
  if (
    !record(value) ||
    value.source !== 'binance' ||
    value.stream !== stream ||
    value.symbol !== stream.slice(0, -'@miniTicker'.length).toUpperCase() ||
    !['waiting', 'live', 'stale', 'unavailable', 'rejected'].includes(
      String(value.status),
    )
  )
    throw invalidResponse();
  const price = value.price;
  if (
    price !== null &&
    (typeof price !== 'string' ||
      price.length > 64 ||
      !/^\d+(?:\.\d+)?$/.test(price) ||
      !/[1-9]/.test(price))
  )
    throw invalidResponse();
  for (const time of [value.updatedAtMs, value.receivedAtMs]) {
    if (
      time !== null &&
      (typeof time !== 'number' || !Number.isSafeInteger(time) || time <= 0)
    )
      throw invalidResponse();
  }
  if (
    value.status === 'live' &&
    (price === null ||
      value.updatedAtMs === null ||
      value.receivedAtMs === null)
  )
    throw invalidResponse();
  return {
    source: 'binance',
    stream,
    symbol: value.symbol,
    price,
    updatedAtMs: value.updatedAtMs as number | null,
    receivedAtMs: value.receivedAtMs as number | null,
    status: value.status as BinancePriceSnapshot['status'],
  };
}
