import type { SubscriptionOptions } from './types.js';

export interface PumpfunCallout {
  source: 'pumpfun';
  kind: 'callout';
  calloutId: string;
  chain: string;
  author: {
    id: string;
    name: string | null;
    walletAddress: string;
    avatarUrl: string | null;
    verified: boolean;
    xUsername: string | null;
  };
  token: {
    mint: string;
    name: string;
    symbol: string;
    imageUrl: string | null;
  };
  text: string;
  mediaUrl: string | null;
  flagged: boolean;
  createdAtMs: number;
  receivedAtMs: number;
}
export interface PumpfunStatus {
  state: 'connecting' | 'live' | 'degraded' | 'disconnected';
  lastEventAtMs: number | null;
}
export interface PumpfunGetParams {
  limit?: number;
}
export interface PumpfunCalloutsResult {
  callouts: PumpfunCallout[];
  status: PumpfunStatus;
}
export type PumpfunUpdate =
  | { type: 'callout'; callout: PumpfunCallout }
  | { type: 'status'; status: PumpfunStatus };
export type PumpfunSubscriptionOptions = SubscriptionOptions<PumpfunUpdate>;
export interface PumpfunNotification {
  jsonrpc: '2.0';
  method: 'pumpfun.calloutNotification';
  params: { subscription: string; sequence: number; result: PumpfunUpdate };
}
export type PumpfunRpcMethods = {
  'pumpfun.getCallouts'(
    params?: PumpfunGetParams,
  ): Promise<PumpfunCalloutsResult>;
  'pumpfun.subscribeCallouts'(params?: Record<string, never>): Promise<string>;
  'pumpfun.unsubscribeCallouts'(params: {
    subscription: string;
  }): Promise<boolean>;
};
