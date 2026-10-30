import { record, invalidResponse } from './protocol.js';
import { DataError } from './types.js';
import type {
  PumpfunCallout,
  PumpfunCalloutsResult,
  PumpfunGetParams,
  PumpfunStatus,
  PumpfunUpdate,
} from './pumpfun.contracts.js';

function string(value: unknown, max: number, min = 0): value is string {
  return (
    typeof value === 'string' && value.length >= min && value.length <= max
  );
}
function time(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function image(value: unknown): value is string | null {
  if (value === null) return true;
  if (!string(value, 2048, 1)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}
export function calloutParams(input?: PumpfunGetParams): { limit: number } {
  if (
    input !== undefined &&
    (!record(input) || Object.keys(input).some((key) => key !== 'limit'))
  )
    throw new DataError('invalid_params', 'Invalid callout query.');
  const limit = input?.limit ?? 50;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new DataError(
      'invalid_params',
      'Callout limit must be between 1 and 50.',
    );
  return { limit };
}
export function readCallout(value: unknown): PumpfunCallout {
  if (
    !record(value) ||
    value.source !== 'pumpfun' ||
    value.kind !== 'callout' ||
    !string(value.calloutId, 128, 1) ||
    !string(value.chain, 32, 1) ||
    !/^[a-z0-9:_-]+$/.test(value.chain) ||
    !record(value.author) ||
    !record(value.token)
  )
    throw invalidResponse();
  const a = value.author,
    t = value.token;
  if (
    !string(a.id, 128, 1) ||
    !(a.name === null || string(a.name, 160, 1)) ||
    !string(a.walletAddress, 128, 1) ||
    !image(a.avatarUrl) ||
    typeof a.verified !== 'boolean' ||
    !(a.xUsername === null || string(a.xUsername, 64)) ||
    !string(t.mint, 128, 1) ||
    !string(t.name, 160) ||
    !string(t.symbol, 64) ||
    !image(t.imageUrl) ||
    !string(value.text, 4000) ||
    !image(value.mediaUrl) ||
    (!value.text.trim() && value.mediaUrl === null) ||
    typeof value.flagged !== 'boolean' ||
    !time(value.createdAtMs) ||
    !time(value.receivedAtMs)
  )
    throw invalidResponse();
  return {
    source: 'pumpfun',
    kind: 'callout',
    calloutId: value.calloutId,
    chain: value.chain,
    author: {
      id: a.id,
      name: a.name,
      walletAddress: a.walletAddress,
      avatarUrl: a.avatarUrl,
      verified: a.verified,
      xUsername: a.xUsername,
    },
    token: {
      mint: t.mint,
      name: t.name,
      symbol: t.symbol,
      imageUrl: t.imageUrl,
    },
    text: value.text,
    mediaUrl: value.mediaUrl,
    flagged: value.flagged,
    createdAtMs: value.createdAtMs,
    receivedAtMs: value.receivedAtMs,
  };
}
export function readPumpfunStatus(value: unknown): PumpfunStatus {
  if (
    !record(value) ||
    !['connecting', 'live', 'degraded', 'disconnected'].includes(
      String(value.state),
    ) ||
    !(value.lastEventAtMs === null || time(value.lastEventAtMs))
  )
    throw invalidResponse();
  return {
    state: value.state as PumpfunStatus['state'],
    lastEventAtMs: value.lastEventAtMs,
  };
}
export function readCallouts(
  value: unknown,
  limit = 50,
): PumpfunCalloutsResult {
  if (
    !record(value) ||
    !Array.isArray(value.callouts) ||
    value.callouts.length > limit
  )
    throw invalidResponse();
  return {
    callouts: value.callouts.map(readCallout),
    status: readPumpfunStatus(value.status),
  };
}
export function readPumpfunUpdate(value: unknown): PumpfunUpdate {
  if (!record(value)) throw invalidResponse();
  if (value.type === 'callout')
    return { type: 'callout', callout: readCallout(value.callout) };
  if (value.type === 'status')
    return { type: 'status', status: readPumpfunStatus(value.status) };
  throw invalidResponse();
}
