import type { PlatformFee, TransactionBuildResult } from './transactions.js';

export interface PumpSwapOptions {
  network?: string;
  /** Public address; signing authority remains in the browser. */
  address: string;
  mint: string;
  side: 'buy' | 'sell';
  /** Exact input: lamports for a buy, token base units for a sell. */
  amount: string;
  slippageBps: number;
  priorityFeeLamports?: number;
  /** Separate mainnet HelloMoon tip; 0 (default) or 10,000..10,000,000 lamports. */
  bribeFeeLamports?: number;
}

export interface PumpSwapQuote {
  quoteMint?: string;
  bridge?: { protocol: 'jupiter'; quoteMint: string };
  /** Nuxus fee; output-side amounts are estimates until execution. */
  platformFee?: PlatformFee;
  protocol: 'pump-curve';
  address: string;
  mint: string;
  side: 'buy' | 'sell';
  input: { baseUnits: string; decimals: number };
  expectedOutput: { baseUnits: string; decimals: number };
  minimumOutput: { baseUnits: string; decimals: number };
  slippageBps: number;
  contextSlot: number;
  protocolFeeBps: number;
  creatorFeeBps: number;
}

export interface PumpSwapBuildResult extends TransactionBuildResult {
  quote: PumpSwapQuote;
}

export type JupiterSwapOptions = PumpSwapOptions;

export interface JupiterSwapQuote extends Omit<
  PumpSwapQuote,
  'protocol' | 'bridge' | 'protocolFeeBps' | 'creatorFeeBps'
> {
  protocol: 'jupiter';
  quoteMint: string;
  bribeFeeLamports: number;
}

export interface JupiterSwapBuildResult extends TransactionBuildResult {
  quote: JupiterSwapQuote;
}

/** Exact-input SOL/WSOL swap on a standard, pre-migration Meteora DBC pool. */
export interface MeteoraDbcSwapOptions extends PumpSwapOptions {
  /** DBC pool address; the engine validates its config, mint and vaults on chain. */
  pool: string;
}

export interface MeteoraDbcSwapQuote extends Omit<
  PumpSwapQuote,
  'protocol' | 'protocolFeeBps' | 'creatorFeeBps'
> {
  protocol: 'meteora-dbc';
  pool: string;
  quoteMint: string;
  feeMint: string;
  tradingFeeBaseUnits: string;
  protocolFeeBaseUnits: string;
  bribeFeeLamports: number;
}

export interface MeteoraDbcSwapBuildResult extends TransactionBuildResult {
  quote: MeteoraDbcSwapQuote;
}

/** SOL/WSOL exact-input DLMM swap, with fresh bin-array state. */
export interface MeteoraDlmmSwapOptions extends PumpSwapOptions {
  pool: string;
}

export interface MeteoraDlmmSwapQuote extends Omit<
  MeteoraDbcSwapQuote,
  'protocol'
> {
  protocol: 'meteora-dlmm';
  binArrayCount: number;
}

export interface MeteoraDlmmSwapBuildResult extends TransactionBuildResult {
  quote: MeteoraDlmmSwapQuote;
}

/** Exact-input SOL/WSOL swap; the engine resolves token A/B ordering on chain. */
export interface MeteoraDammV2SwapOptions extends PumpSwapOptions {
  pool: string;
}

export interface MeteoraDammV2SwapQuote extends Omit<
  MeteoraDbcSwapQuote,
  'protocol'
> {
  protocol: 'meteora-damm-v2';
  claimingFeeBaseUnits: string;
  compoundingFeeBaseUnits: string;
}

export interface MeteoraDammV2SwapBuildResult extends TransactionBuildResult {
  quote: MeteoraDammV2SwapQuote;
}

/** Exact-input SPL Token/WSOL swap on a constant-product DAMM v1 pool. */
export interface MeteoraDammV1SwapOptions extends PumpSwapOptions {
  pool: string;
}

export interface MeteoraDammV1SwapQuote extends Omit<
  MeteoraDbcSwapQuote,
  'protocol'
> {
  protocol: 'meteora-damm-v1';
}

export interface MeteoraDammV1SwapBuildResult extends TransactionBuildResult {
  quote: MeteoraDammV1SwapQuote;
}

/** Exact-input SOL/WSOL swap on a migrated Pump AMM pool. */
export interface PumpAmmSwapOptions extends PumpSwapOptions {
  pool: string;
}

export interface PumpAmmSwapQuote extends Omit<PumpSwapQuote, 'protocol'> {
  protocol: 'pump-amm';
  pool: string;
  quoteMint: string;
  feeMint: string;
  lpFeeBps: number;
  lpFeeBaseUnits: string;
  protocolFeeBaseUnits: string;
  creatorFeeBaseUnits: string;
  bribeFeeLamports: number;
}

export interface PumpAmmSwapBuildResult extends TransactionBuildResult {
  quote: PumpAmmSwapQuote;
}

/** SOL/WSOL CPMM exact-input swap, either token order. */
export interface RaydiumCpmmSwapOptions extends PumpSwapOptions {
  pool: string;
}

export interface RaydiumCpmmSwapQuote extends Omit<
  MeteoraDbcSwapQuote,
  'protocol'
> {
  protocol: 'raydium-cpmm';
  /** Trade/protocol/fund fees are in feeMint; creator fee can be in the output mint. */
  creatorFeeMint: string;
  fundFeeBaseUnits: string;
  creatorFeeBaseUnits: string;
}

export interface RaydiumCpmmSwapBuildResult extends TransactionBuildResult {
  quote: RaydiumCpmmSwapQuote;
}

export interface RaydiumLaunchlabSwapOptions extends PumpSwapOptions {
  /** Active pre-migration LaunchLab pool; validated against mint and WSOL. */
  pool: string;
}

export interface RaydiumLaunchlabSwapQuote extends Omit<
  PumpSwapQuote,
  'protocol' | 'protocolFeeBps' | 'creatorFeeBps'
> {
  protocol: 'raydium-launchlab';
  pool: string;
  quoteMint: string;
  feeMint: string;
  protocolFeeBaseUnits: string;
  platformFeeBaseUnits: string;
  creatorFeeBaseUnits: string;
  shareFeeBaseUnits: string;
  bribeFeeLamports: number;
  curveType: 0 | 1;
}

export interface RaydiumLaunchlabSwapBuildResult extends TransactionBuildResult {
  quote: RaydiumLaunchlabSwapQuote;
}
