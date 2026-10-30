import type { PlatformFee, TransactionBuildResult } from './transactions.js';

/** SOL decimal input. Strings preserve exact precision for large amounts. */
export type SolAmount = number | string;

/** All percentages use integer basis points (100 bps = 1%). */
export type PumpFeeRecipient =
  | { type: 'wallet'; address: string; shareBps: number }
  | { type: 'github'; username: string; shareBps: number }
  | { type: 'twitter'; userId: string; shareBps: number }
  | { type: 'charity'; configId: string; shareBps: number };

export interface PumpCreateSettings {
  /** Register a Pump.fun page without creating the mint on chain (app flow). */
  offchain?: boolean;
  /** Omit for SOL. Other mints are validated against Pump's on-chain registry. */
  quoteMint?: string;
  /** 0/omitted uses the dynamic schedule. Custom pairs only, never SOL or USDC. */
  creatorFeeBps?: number;
  mayhem?: boolean;
  /** Permanent; creator fees go to holders rather than fee recipients. */
  holderRewards?: boolean;
  /** 1..10 unique recipients with positive shares totaling 10,000 bps. */
  feeRecipients?: PumpFeeRecipient[];
}

export interface PumpLaunchOptions {
  contextSlot: number;
  createEnabled: boolean;
  mayhemEnabled: boolean;
  holderRewardsEnabled: boolean;
  creatorFeeConfigurable: boolean;
  maxCreatorFeeBps: number;
  quotes: {
    mint: string;
    customFee: boolean;
    mayhem: boolean;
  }[];
}

export interface CreateOffchainTokenOptions {
  network?: string;
  creator: string;
  metadata: CreateTokenMetadata;
  /** Signature of exactly `Sign in to pump.fun: ${timestamp}`. No wallet key. */
  auth: { timestamp: number; signature: string };
}

export interface CreateOffchainTokenResult {
  status: 'offchain';
  network: string;
  mint: string;
  metadataUri: string;
  url: string;
}

export interface PumpCharityConfig {
  configId: string;
  feeBps: number;
  charities: { id: string; name: string; weight: string }[];
}

export type CreateTokenMetadata = {
  name: string;
  symbol: string;
} & (
  | {
      uri: string;
      image?: never;
      image_url?: never;
      description?: never;
      website?: never;
      twitter?: never;
      telegram?: never;
    }
  | ({
      uri?: never;
      description?: string;
      website?: string;
      twitter?: string;
      telegram?: string;
    } & (
      | { image: string; image_url?: never }
      | { image_url: string; image?: never }
    ))
);

export interface CreateTokenOptions {
  network?: string;
  creator: string;
  platform: 'pump' | 'bonk' | 'stonk';
  /** Creator buy in native SOL; omitted/0 creates without buying. */
  amount?: SolAmount;
  /** Inline fields are published through the engine's private API connection.
   * image/image_url accepts an HTTPS URL or PNG/JPEG/WebP/GIF data URL up to 5 MiB.
   * An existing published HTTPS uri is also supported. */
  metadata: CreateTokenMetadata;
  pump?: PumpCreateSettings;
  /** Bonk Classic and Stonk Standard currently accept only the WSOL mint. */
  quoteMint?: string;
  /** Slippage for a SOL -> quote-token bridge; default 100 bps. */
  slippageBps?: number;
  fees?: { bribe?: SolAmount; priority?: SolAmount };
  bundles?: null | [];
  /** Optional base58 64-byte mint keypair. Never pass a wallet private key. */
  mint?: string;
}

/** Direct Pump entry point; platform selection is unnecessary. */
export type PumpCreateTokenOptions = Omit<
  CreateTokenOptions,
  'platform' | 'quoteMint'
>;

export type LaunchlabCreateTokenOptions = Omit<
  CreateTokenOptions,
  'platform' | 'pump'
> & {
  platform: 'bonk' | 'stonk';
};

export interface CreateTokenResult extends TransactionBuildResult {
  platform: 'pump' | 'bonk' | 'stonk';
  mint: string;
  metadataUri: string;
  launchlab?: {
    mode: 'standard';
    pool: string;
    quoteMint: string;
    globalConfig: string;
    platformConfig: string;
    baseTokenProgram: string;
    supply: string;
    totalBaseSell: string;
    totalQuoteFundRaising: string;
  };
  pump?: {
    quoteMint: string;
    mayhem: boolean;
    holderRewards: boolean;
    creatorFeeBps: number;
    feeRecipients: { address: string; shareBps: number }[];
  };
  quote: {
    bridge?: { protocol: 'jupiter'; quoteMint: string };
    platformFee?: PlatformFee;
    asset: 'solana:native';
    input: { baseUnits: string; decimals: 9 };
    expectedOutput: { baseUnits: string; decimals: 6 };
    minimumOutput: { baseUnits: string; decimals: 6 };
  };
}
