import { calloutParams, readCallouts } from './pumpfun.protocol.js';
import { balanceParams, readBalances } from './solana.protocol.js';
import { validateStream, readPrice } from './binance.protocol.js';
import { readPong, record } from './protocol.js';
import { DataError } from './types.js';
import type {
  BinancePriceSnapshot,
  DataQuery,
  DataQueryResult,
} from './contracts.js';

export function prepareQuery(input: DataQuery): {
  method: string;
  params?: object;
  parse: (value: unknown) => DataQueryResult;
} {
  if (input.method === 'pumpfun.getCallouts') {
    const params = calloutParams(input.params);
    return {
      method: input.method,
      params,
      parse: (value) => readCallouts(value, params.limit),
    };
  }
  if (input.method === 'ping') {
    if (
      input.params !== undefined &&
      ((!record(input.params) && !Array.isArray(input.params)) ||
        Object.keys(input.params).length)
    )
      throw new DataError('invalid_params', 'ping accepts empty params only.');
    return { method: 'ping', parse: readPong };
  }
  if (input.method === 'binance.getPrice') {
    validateStream(input.params?.stream);
    const stream = input.params.stream;
    return {
      method: input.method,
      params: { stream },
      parse: (value): BinancePriceSnapshot => readPrice(value, stream),
    };
  }
  if (
    input.method === 'solana.getNativeBalances' ||
    input.method === 'solana.getTokenBalances'
  ) {
    const params = balanceParams(input.params);
    if (input.method === 'solana.getTokenBalances' && !params.mint)
      throw new DataError('invalid_params', 'Mint is required.');
    return {
      method: input.method,
      params,
      parse: (value): DataQueryResult => readBalances(value, params),
    };
  }
  throw new DataError(
    'unsupported_method',
    'Use typed subscription helpers; request/batch support data queries only.',
  );
}
