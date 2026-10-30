import type {
  NativeBalancesOptions,
  TokenBalancesOptions,
  SolanaOptions,
  NativeBalanceSnapshot,
  TokenBalanceSnapshot,
  NativeBalancesResult,
  TokenBalancesResult,
} from './solana.contracts.js';
import { DataError } from './types.js';
import { invalidResponse, record } from './protocol.js';

// Validate decoded base58 length without adding a runtime dependency to the SDK.
export function validAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value))
    return false;
  let n = 0n;
  for (const char of value)
    n =
      n * 58n +
      BigInt(
        '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'.indexOf(
          char,
        ),
      );
  let bytes = 0;
  while (n) {
    bytes++;
    n >>= 8n;
  }
  return bytes + (value.match(/^1*/)?.[0].length ?? 0) === 32;
}
export function solanaOptions(input: SolanaOptions): Required<SolanaOptions> {
  const network = input.network ?? 'solana:mainnet-beta';
  const commitment = input.commitment ?? 'finalized';
  if (
    !['solana:mainnet-beta', 'solana:devnet'].includes(network) ||
    !['processed', 'confirmed', 'finalized'].includes(commitment)
  )
    throw new DataError(
      'invalid_params',
      'Invalid Solana network or commitment.',
    );
  return { network, commitment };
}
export function balanceParams(
  input: NativeBalancesOptions | TokenBalancesOptions,
): Required<NativeBalancesOptions> & { mint?: string } {
  if (
    !Array.isArray(input.addresses) ||
    !input.addresses.length ||
    input.addresses.length > 100 ||
    input.addresses.some((address) => !validAddress(address)) ||
    new Set(input.addresses).size !== input.addresses.length ||
    ('mint' in input && !validAddress(input.mint))
  )
    throw new DataError(
      'invalid_params',
      'Provide 1 to 100 distinct Solana wallets and a valid mint.',
    );
  return {
    ...solanaOptions(input),
    addresses: [...input.addresses],
    ...('mint' in input ? { mint: input.mint } : {}),
  };
}
type Expected = Required<SolanaOptions> & { address: string; mint?: string };
function amount(value: unknown): { baseUnits: string; decimals: number } {
  if (
    !record(value) ||
    typeof value.baseUnits !== 'string' ||
    !/^\d{1,20}$/.test(value.baseUnits) ||
    BigInt(value.baseUnits) > 18446744073709551615n ||
    typeof value.decimals !== 'number' ||
    !Number.isInteger(value.decimals) ||
    value.decimals < 0 ||
    value.decimals > 255
  )
    throw invalidResponse();
  return { baseUnits: value.baseUnits, decimals: value.decimals };
}
export function readBalance(
  value: unknown,
  expected: Expected,
): NativeBalanceSnapshot | TokenBalanceSnapshot {
  if (
    !record(value) ||
    value.network !== expected.network ||
    value.commitment !== expected.commitment ||
    value.address !== expected.address ||
    !record(value.context) ||
    typeof value.context.slot !== 'number' ||
    !Number.isSafeInteger(value.context.slot) ||
    value.context.slot < 0 ||
    typeof value.exists !== 'boolean'
  )
    throw invalidResponse();
  const units = amount(value.amount);
  const common = {
    network: expected.network,
    commitment: expected.commitment,
    context: { slot: value.context.slot },
    address: expected.address,
    exists: value.exists,
  };
  if (expected.mint) {
    if (
      value.mint !== expected.mint ||
      ![
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      ].includes(String(value.tokenProgram)) ||
      value.scope !== 'associatedTokenAccount' ||
      !validAddress(value.tokenAccount) ||
      typeof value.frozen !== 'boolean'
    )
      throw invalidResponse();
    return {
      ...common,
      amount: units,
      mint: expected.mint,
      tokenProgram: value.tokenProgram as TokenBalanceSnapshot['tokenProgram'],
      tokenAccount: value.tokenAccount,
      frozen: value.frozen,
      scope: 'associatedTokenAccount',
    };
  }
  if (value.asset !== 'solana:native' || units.decimals !== 9)
    throw invalidResponse();
  return {
    ...common,
    asset: 'solana:native',
    amount: { baseUnits: units.baseUnits, decimals: 9 },
  };
}
export function readBalances(
  value: unknown,
  expected: Required<NativeBalancesOptions> & { mint?: string },
): NativeBalancesResult | TokenBalancesResult {
  if (
    !record(value) ||
    !Array.isArray(value.balances) ||
    value.balances.length !== expected.addresses.length
  )
    throw invalidResponse();
  const snapshots = value.balances.map((balance: unknown, index) => {
    if (!record(balance)) throw invalidResponse();
    return readBalance(
      { ...value, ...balance },
      { ...expected, address: expected.addresses[index]! },
    );
  });
  const first = snapshots[0]!;
  const common = {
    network: first.network,
    commitment: first.commitment,
    context: first.context,
  };
  if ('mint' in first)
    return {
      ...common,
      mint: first.mint,
      tokenProgram: first.tokenProgram,
      scope: first.scope,
      balances: snapshots.map((item) => {
        if (
          !('mint' in item) ||
          item.tokenProgram !== first.tokenProgram ||
          item.amount.decimals !== first.amount.decimals
        )
          throw invalidResponse();
        return {
          address: item.address,
          tokenAccount: item.tokenAccount,
          exists: item.exists,
          frozen: item.frozen,
          amount: item.amount,
        };
      }),
    };
  return {
    ...common,
    asset: 'solana:native',
    balances: snapshots.map((item) => {
      if (!('asset' in item)) throw invalidResponse();
      return {
        address: item.address,
        exists: item.exists,
        amount: item.amount,
      };
    }),
  };
}
