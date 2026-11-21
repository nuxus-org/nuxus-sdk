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

interface CommonCreateOptions {
  network?: string;
  creator: string;
  /** Creator buy in native SOL; omitted/0 creates without buying. */
  amount?: SolAmount;
  /** Inline fields are published through the engine's private API connection.
   * image/image_url accepts an HTTPS URL or PNG/JPEG/WebP/GIF data URL up to 5 MiB.
   * An existing published HTTPS uri is also supported. */
  metadata: CreateTokenMetadata;
  pump?: PumpCreateSettings;
  /** Standard LaunchLab launches currently accept only the WSOL mint. */
  quoteMint?: string;
  /** Slippage in basis points for the initial DBC buy or Pump quote bridge. */
  slippageBps?: number;
  fees?: { bribe?: SolAmount; priority?: SolAmount };
  bundles?: null | [];
  /** Optional base58 64-byte mint keypair. Never pass a wallet private key. */
  mint?: string;
}

export type MeteoraDbcCreateOptions = Omit<
  CommonCreateOptions,
  'pump' | 'quoteMint'
> & {
  /** Existing PoolConfig on the selected Solana network. */
  config: string;
  expectedConfigHash?: string;
};
export type CreateTokenOptions =
  | (CommonCreateOptions & { platform: 'pump' | 'bonk' | 'stonk' | 'raydium' })
  | (MeteoraDbcCreateOptions & { platform: 'meteora' })
  | (Omit<CommonCreateOptions, 'pump' | 'quoteMint'> & {
      platform: 'otc';
      otc: { rewardMint: string; rewardSymbol: string };
    })
  | (Omit<CommonCreateOptions, 'pump' | 'quoteMint' | 'metadata'> & {
      platform: 'paid';
      metadata: Exclude<CreateTokenMetadata, { uri: string }>;
      paid: { recipient: string };
    });

export type PumpCreateTokenOptions = Omit<CommonCreateOptions, 'quoteMint'>;
export type LaunchlabCreateTokenOptions = Omit<CommonCreateOptions, 'pump'> & {
  platform: 'bonk' | 'stonk' | 'raydium';
};

export interface MeteoraDbcLaunchConfig {
  configHash: string;
  config: string;
  quoteMint: string;
  tokenProgram: string;
  decimals: number;
  poolCreationFeeLamports: string;
  initialBaseFeeNumerator: string;
  feeDenominator: number;
  dynamicFee: boolean;
  feeClaimer: string;
  transferFeeBps: number;
  creatorTradingFeePercent: number;
  migration: 'damm-v2';
  migrationFeePercent: number;
  creatorMigrationFeeSharePercent: number;
  migrationQuoteThreshold: string;
}

export interface CreateTokenResult extends TransactionBuildResult {
  platform: CreateTokenOptions['platform'];
  paid?: { recipient: string };
  otc?: { rewardMint: string; rewardSymbol: string };
  meteora?: MeteoraDbcLaunchConfig & { pool: string };
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
    expectedOutput: { baseUnits: string; decimals: number };
    minimumOutput: { baseUnits: string; decimals: number };
  };
}
