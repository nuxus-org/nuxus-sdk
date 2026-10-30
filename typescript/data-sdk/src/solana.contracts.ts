import type { SubscriptionOptions } from './types.js';

export type SolanaNetwork = 'solana:mainnet-beta' | 'solana:devnet';
export type SolanaCommitment = 'processed' | 'confirmed' | 'finalized';
export interface SolanaOptions {
  network?: SolanaNetwork;
  commitment?: SolanaCommitment;
}
export interface NativeBalancesOptions extends SolanaOptions {
  addresses: string[];
}
export interface TokenBalancesOptions extends NativeBalancesOptions {
  mint: string;
}
export interface NativeBalance {
  address: string;
  exists: boolean;
  amount: { baseUnits: string; decimals: 9 };
}
export interface TokenBalance {
  address: string;
  tokenAccount: string;
  exists: boolean;
  frozen: boolean;
  amount: { baseUnits: string; decimals: number };
}
interface Context {
  network: SolanaNetwork;
  commitment: SolanaCommitment;
  context: { slot: number };
}
interface TokenMeta {
  mint: string;
  tokenProgram:
    | 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    | 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  scope: 'associatedTokenAccount';
}
export interface NativeBalancesResult extends Context {
  asset: 'solana:native';
  balances: NativeBalance[];
}
export interface TokenBalancesResult extends Context, TokenMeta {
  balances: TokenBalance[];
}
export interface NativeBalanceSnapshot extends Context, NativeBalance {
  asset: 'solana:native';
}
export interface TokenBalanceSnapshot
  extends Context, TokenMeta, TokenBalance {}
export interface NativeBalanceSubscriptionOptions
  extends SolanaOptions, SubscriptionOptions<NativeBalanceSnapshot> {
  address: string;
  initialSnapshot?: boolean;
}
export interface TokenBalanceSubscriptionOptions
  extends SolanaOptions, SubscriptionOptions<TokenBalanceSnapshot> {
  address: string;
  mint: string;
}
export type SolanaRpcMethods = {
  'solana.getNativeBalances'(
    params: NativeBalancesOptions,
  ): Promise<NativeBalancesResult>;
  'solana.getTokenBalances'(
    params: TokenBalancesOptions,
  ): Promise<TokenBalancesResult>;
  'solana.subscribeBalance'(
    params: SolanaOptions & { address: string; initialSnapshot?: boolean },
  ): Promise<string>;
  'solana.subscribeTokenBalance'(
    params: SolanaOptions & { address: string; mint: string },
  ): Promise<string>;
  'solana.unsubscribeBalance'(params: {
    subscription: string;
  }): Promise<boolean>;
  'solana.unsubscribeTokenBalance'(params: {
    subscription: string;
  }): Promise<boolean>;
};
export type BalanceNotification = {
  jsonrpc: '2.0';
  method: 'solana.balanceNotification' | 'solana.tokenBalanceNotification';
  params: { subscription: string; sequence: number } & (
    | { result: NativeBalanceSnapshot | TokenBalanceSnapshot; error?: never }
    | { error: { code: -32010; message: string }; result?: never }
  );
};
