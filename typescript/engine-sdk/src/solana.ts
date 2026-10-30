import type {
  EngineRequest,
  EngineSubscription,
  SubscriptionOptions,
  SignatureSubscriptionOptions,
  Unsubscribe,
  TransferOptions,
  TransferResult,
  CreateTokenAccountOptions,
  CreateTokenOptions,
  LaunchlabCreateTokenOptions,
  PumpCreateTokenOptions,
  PumpLaunchOptions,
  CreateOffchainTokenOptions,
  CreateOffchainTokenResult,
  PumpCharityConfig,
  PumpCreateSettings,
  CreateTokenResult,
  CreateTokenAccountResult,
  PumpSwapOptions,
  PumpAmmSwapOptions,
  PumpAmmSwapBuildResult,
  PumpSwapBuildResult,
  JupiterSwapOptions,
  JupiterSwapBuildResult,
  MeteoraDbcSwapOptions,
  MeteoraDlmmSwapOptions,
  MeteoraDlmmSwapBuildResult,
  MeteoraDbcSwapBuildResult,
  MeteoraDammV2SwapOptions,
  MeteoraDammV2SwapBuildResult,
  MeteoraDammV1SwapOptions,
  MeteoraDammV1SwapBuildResult,
  RaydiumLaunchlabSwapOptions,
  RaydiumCpmmSwapOptions,
  RaydiumCpmmSwapBuildResult,
  RaydiumLaunchlabSwapBuildResult,
  BroadcastTransactionOptions,
  BroadcastTransactionResult,
  SimulateTransactionOptions,
  SimulateTransactionResult,
} from './types.js';
import { TOKEN_CREATION_TIMEOUT_MS } from './constants.js';

export interface SolanaApi {
  createToken: (options: CreateTokenOptions) => Promise<CreateTokenResult>;
  simulateTransaction: (
    options: SimulateTransactionOptions,
  ) => Promise<SimulateTransactionResult>;
  broadcastTransaction: (
    options: BroadcastTransactionOptions,
  ) => Promise<BroadcastTransactionResult>;
  jupiter: {
    swap: (options: JupiterSwapOptions) => Promise<JupiterSwapBuildResult>;
  };
  pump: {
    getTokenSettings: (options: { mint: string; network?: string }) => Promise<{
      contextSlot: number;
      settings: PumpCreateSettings;
    }>;
    getCharityConfig: (options: {
      configId: string;
      network?: string;
    }) => Promise<PumpCharityConfig>;
    createOffchainToken: (
      options: CreateOffchainTokenOptions,
    ) => Promise<CreateOffchainTokenResult>;
    getLaunchOptions: (options?: {
      network?: string;
    }) => Promise<PumpLaunchOptions>;
    amm: {
      swap: (options: PumpAmmSwapOptions) => Promise<PumpAmmSwapBuildResult>;
    };
    createToken: (
      options: PumpCreateTokenOptions,
    ) => Promise<CreateTokenResult>;
    swap: (options: PumpSwapOptions) => Promise<PumpSwapBuildResult>;
  };
  meteora: {
    dlmm: {
      swap: (
        options: MeteoraDlmmSwapOptions,
      ) => Promise<MeteoraDlmmSwapBuildResult>;
    };
    dammV1: {
      swap: (
        options: MeteoraDammV1SwapOptions,
      ) => Promise<MeteoraDammV1SwapBuildResult>;
    };
    dammV2: {
      swap: (
        options: MeteoraDammV2SwapOptions,
      ) => Promise<MeteoraDammV2SwapBuildResult>;
    };
    dbc: {
      swap: (
        options: MeteoraDbcSwapOptions,
      ) => Promise<MeteoraDbcSwapBuildResult>;
    };
  };
  raydium: {
    cpmm: {
      swap: (
        options: RaydiumCpmmSwapOptions,
      ) => Promise<RaydiumCpmmSwapBuildResult>;
    };
    launchlab: {
      createToken: (
        options: LaunchlabCreateTokenOptions,
      ) => Promise<CreateTokenResult>;
      swap: (
        options: RaydiumLaunchlabSwapOptions,
      ) => Promise<RaydiumLaunchlabSwapBuildResult>;
    };
  };
  associatedTokenAccount: {
    createIdempotent: (
      options: CreateTokenAccountOptions,
    ) => Promise<CreateTokenAccountResult>;
  };
  transfer: (options: TransferOptions) => Promise<TransferResult>;
  subscribeSignature: (
    options: SignatureSubscriptionOptions,
  ) => Promise<Unsubscribe>;
}

export interface EngineOperations {
  request<T = unknown>(
    this: void,
    input: EngineRequest,
    minimumTimeoutMs?: number,
  ): Promise<T>;
  subscribe<T>(
    this: void,
    input: EngineSubscription,
    handlers: SubscriptionOptions<T>,
  ): Promise<Unsubscribe>;
}

export function createSolanaApi({
  request,
  subscribe,
}: EngineOperations): SolanaApi {
  const requestCreation = <T>(method: string, params: object): Promise<T> =>
    request<T>({ method, params: { ...params } }, TOKEN_CREATION_TIMEOUT_MS);
  return {
    createToken: (options: CreateTokenOptions): Promise<CreateTokenResult> =>
      requestCreation<CreateTokenResult>('solana.createToken', options),
    /** Simulate an unsigned v1 transaction without broadcasting or replacing its blockhash. */
    simulateTransaction: (
      options: SimulateTransactionOptions,
    ): Promise<SimulateTransactionResult> =>
      request({
        method: 'solana.simulateTransaction',
        params: { ...options },
      }),
    broadcastTransaction: (
      options: BroadcastTransactionOptions,
    ): Promise<BroadcastTransactionResult> =>
      request({
        method: 'solana.broadcastTransaction',
        params: { ...options },
      }),
    jupiter: {
      swap: (options: JupiterSwapOptions): Promise<JupiterSwapBuildResult> =>
        request({ method: 'solana.jupiter.swap', params: { ...options } }),
    },
    pump: {
      getTokenSettings: (options: {
        mint: string;
        network?: string;
      }): Promise<{ contextSlot: number; settings: PumpCreateSettings }> =>
        request({
          method: 'solana.pump.getTokenSettings',
          params: { ...options },
        }),
      getCharityConfig: (options: {
        configId: string;
        network?: string;
      }): Promise<PumpCharityConfig> =>
        request({
          method: 'solana.pump.getCharityConfig',
          params: { ...options },
        }),
      createOffchainToken: (
        options: CreateOffchainTokenOptions,
      ): Promise<CreateOffchainTokenResult> =>
        requestCreation<CreateOffchainTokenResult>(
          'solana.pump.createOffchainToken',
          options,
        ),
      getLaunchOptions: (
        options: { network?: string } = {},
      ): Promise<PumpLaunchOptions> =>
        request({
          method: 'solana.pump.getLaunchOptions',
          params: { ...options },
        }),
      amm: {
        swap: (options: PumpAmmSwapOptions): Promise<PumpAmmSwapBuildResult> =>
          request({
            method: 'solana.pump.amm.swap',
            params: { ...options },
          }),
      },
      createToken: (
        options: PumpCreateTokenOptions,
      ): Promise<CreateTokenResult> =>
        requestCreation<CreateTokenResult>('solana.pump.createToken', options),
      swap: (options: PumpSwapOptions): Promise<PumpSwapBuildResult> =>
        request({ method: 'solana.pump.swap', params: { ...options } }),
    },
    meteora: {
      dlmm: {
        swap: (
          options: MeteoraDlmmSwapOptions,
        ): Promise<MeteoraDlmmSwapBuildResult> =>
          request({
            method: 'solana.meteora.dlmm.swap',
            params: { ...options },
          }),
      },
      dammV1: {
        swap: (
          options: MeteoraDammV1SwapOptions,
        ): Promise<MeteoraDammV1SwapBuildResult> =>
          request({
            method: 'solana.meteora.dammV1.swap',
            params: { ...options },
          }),
      },
      dammV2: {
        swap: (
          options: MeteoraDammV2SwapOptions,
        ): Promise<MeteoraDammV2SwapBuildResult> =>
          request({
            method: 'solana.meteora.dammV2.swap',
            params: { ...options },
          }),
      },
      dbc: {
        swap: (
          options: MeteoraDbcSwapOptions,
        ): Promise<MeteoraDbcSwapBuildResult> =>
          request({
            method: 'solana.meteora.dbc.swap',
            params: { ...options },
          }),
      },
    },
    raydium: {
      cpmm: {
        swap: (
          options: RaydiumCpmmSwapOptions,
        ): Promise<RaydiumCpmmSwapBuildResult> =>
          request({
            method: 'solana.raydium.cpmm.swap',
            params: { ...options },
          }),
      },
      launchlab: {
        createToken: (
          options: LaunchlabCreateTokenOptions,
        ): Promise<CreateTokenResult> =>
          requestCreation('solana.raydium.launchlab.createToken', options),
        swap: (
          options: RaydiumLaunchlabSwapOptions,
        ): Promise<RaydiumLaunchlabSwapBuildResult> =>
          request({
            method: 'solana.raydium.launchlab.swap',
            params: { ...options },
          }),
      },
    },
    associatedTokenAccount: {
      createIdempotent: (
        options: CreateTokenAccountOptions,
      ): Promise<CreateTokenAccountResult> =>
        request({
          method: 'solana.associatedTokenAccount.createIdempotent',
          params: { ...options },
        }),
    },
    transfer: (options: TransferOptions): Promise<TransferResult> =>
      request({ method: 'solana.transfer', params: { ...options } }),
    /** Track processed transaction execution; does not wait for finality. */
    subscribeSignature: (
      options: SignatureSubscriptionOptions,
    ): Promise<Unsubscribe> => {
      const { onUpdate, onError, onSubscribed, batch, signal, ...params } =
        options;
      return subscribe(
        {
          method: 'solana.signatureSubscribe',
          notification: 'solana.signatureNotification',
          unsubscribe: 'solana.signatureUnsubscribe',
          once: true,
          params,
        },
        { onUpdate, onError, onSubscribed, batch, signal },
      );
    },
  };
}
