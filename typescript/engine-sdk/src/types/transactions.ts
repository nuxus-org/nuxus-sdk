import type { SubscriptionOptions } from './client.js';

export type SolanaCommitment = 'processed' | 'confirmed' | 'finalized';

export interface SolanaOptions {
  /** Defaults to solana:mainnet-beta. */
  network?: string;
  commitment?: SolanaCommitment;
}

/** A full v1 wire transaction with zeroed trailing signature slots, encoded as base64. */
export interface UnsignedTransaction {
  address: string;
  requiredSigners: string[];
  unsignedTransaction: string;
  /** Detached mint signatures; wallet signatures still must be produced locally. */
  additionalSignatures?: Array<{ address: string; signature: string }>;
}

export interface TransactionBuildResult {
  transactionVersion: 1;
  network: string;
  status: 'prepared';
  blockhash: string;
  lastValidBlockHeight: number;
  contextSlot: number;
  transactions: UnsignedTransaction[];
}

export interface CreateTokenAccountOptions {
  network: string;
  payer: string;
  owner: string;
  mint: string;
}

export interface CreateTokenAccountResult extends TransactionBuildResult {
  tokenAccount: string;
}

export interface TransferOptions {
  network?: string;
  sourceAddresses: string[];
  destinationAddresses: string[];
  /** Total received in lamports, excluding fees; 'max' spends the available balance. */
  amountLamports: string;
}

export interface TransferResult extends TransactionBuildResult {
  amountLamports: string;
  feeLamports: string;
  destinations: Array<{ address: string; amountLamports: string }>;
  transactions: Array<
    UnsignedTransaction & { amountLamports: string; feeLamports: string }
  >;
}

export interface BroadcastTransactionOptions extends Pick<
  SolanaOptions,
  'network'
> {
  /** 1..16 fully signed, base64-encoded v1 transactions, with unique signatures. */
  transactions: string[];
}

export interface BroadcastTransactionResult {
  network: string;
  transactions: Array<{
    signature: string;
    /** First send plus up to 10 retries, spaced 350ms apart. */
    attempts: number;
    /** At least one sendTransaction response acknowledged the expected signature. */
    accepted: boolean;
    /** processed/failed describe observed execution, not consensus finality. */
    status: 'submitted' | 'unknown' | 'processed' | 'failed';
    /** Processed on-chain execution error, if observed. */
    error: unknown;
  }>;
}

export interface PlatformFee {
  bps: 25;
  asset: 'solana:native';
  expectedLamports: string;
  side: 'input' | 'output';
}

/** One-shot execution observation at processed commitment; not proof of finality. */
export interface SignatureNotification {
  network: string;
  signature: string;
  commitment: 'processed';
  context: { slot: number } | null;
  status: 'processed' | 'failed' | 'unknown';
  err: unknown;
}

export interface SignatureSubscriptionOptions extends SubscriptionOptions<SignatureNotification> {
  signature: string;
  network?: string;
}

/** Simulate the exact v1 wire without signatures or broadcasting. WebSocket-only. */
export interface SimulateTransactionOptions {
  network?: string;
  transaction: string;
  minContextSlot?: number;
}

export interface SimulateTransactionResult {
  context: { slot: number };
  value: {
    err: string | Record<string, unknown> | null;
    logs: string[] | null;
    unitsConsumed: number | null;
    returnData: { programId: string; data: [string, 'base64'] } | null;
  };
}
