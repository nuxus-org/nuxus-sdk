# Engine SDK usage

## Browser signing transaction flow

Engine build methods accept public addresses and return `TransactionBuildResult`: `network`, `transactionVersion: 1`, `status: 'prepared'`, `blockhash`, `lastValidBlockHeight`, `contextSlot`, and `transactions`. Each entry has `address`, `requiredSigners` and **`unsignedTransaction`**, a base64 full v1 wire transaction with zero-filled trailing signature slots. It is not a bare message or a signed transaction.

Build methods are WebSocket-only and never sign, submit or store custody operation journals. Jupiter routes are simulated before returning unsigned bytes. The browser signs the exact serialized message, fills the signature slots and calls `broadcastTransaction({ network, transactions: signedBase64Strings })`. Integrate a local signer or wallet provider in your application; this SDK does not depend on a custody provider. Validate the transaction against user intent before signing.

`client.solana.simulateTransaction({ network?, transaction, minContextSlot? })`
explicitly simulates an unsigned base64 v1 transaction over WebSocket, preserving
its blockhash. It returns `{ context: { slot }, value: { err, logs, unitsConsumed,
returnData } }`; execution errors are results with non-null `err`. Nothing is
signed or broadcast. Creates never simulate automatically; the app calls this
only in `VITE_TOKEN_CREATE_PREPARE_ONLY` mode. Automatic simulation remains on
Jupiter swaps and swap bridges.

`client.solana.jupiter.swap({ address, mint, side, amount, slippageBps, priorityFeeLamports?, bribeFeeLamports?, network? })`
trades SOL against a token on mainnet through one Nuxus Jupiter step. No pool is
required; Jupiter chooses its internal route. Buy amounts are SOL lamports, sell
amounts are raw token units. The response is `JupiterSwapBuildResult`, with final
net output/minimum amounts and the usual 25 bps Nuxus fee. Full-transaction preflight
and bounded candidate retries happen before browser signing.

`transfer` builds unsigned SOL transfers. `pump.swap({ address, mint, side, amount, slippageBps, priorityFeeLamports?, bribeFeeLamports?, network? })` builds a Pump bonding-curve transaction and quote using native SOL or a Jupiter-bridged quote asset. Token and Token-2022 mints are supported, including standard and Mayhem curves. Mayhem uses reserved fee recipients and actual mint supply for fee tiers. Cashback remains rejected; migrated coins use the separate `pump.amm.swap` endpoint. Protocol/creator fees are included in the quote; rent, network fees and optional tips are additional. `associatedTokenAccount.createIdempotent({ network, payer, owner, mint })` builds the appropriate Token/Token-2022 ATA instruction.

Pool-specific swap builders bridge non-SOL quote assets through Jupiter on mainnet
when the engine has `JUPITER_API_KEY` configured. Buys route SOL through the pool's
quote asset; sells reverse that route. Buy amounts remain SOL lamports, and sell
amounts remain raw target-token units. `quote.bridge` identifies the intermediary
quote mint; returned output/minimum amounts cover the complete route. Protocol-specific
mint restrictions, available liquidity and transaction limits still apply.

This is a breaking change from server custody. Wallet IDs and old `swapId`/`transferId` execution requests are not accepted. A new build may have a different blockhash or fee recipient: it is not an idempotent retry. Preserve the signed transaction signature before broadcasting. On uncertain delivery, inspect that signature; never automatically build/sign a replacement. `subscribeSignature({ network, signature, onUpdate })` is the single confirmation/recovery API. `unknown` does not mean failed; explicitly subscribe again to retry tracking. The former `getTransfer` / `pump.getSwap` methods and status DTOs are removed.

### Signed Solana transaction broadcast

`client.solana.meteora.dbc.swap({ address, pool, mint, side, amount, slippageBps,
priorityFeeLamports?, bribeFeeLamports?, network? })` builds an unsigned exact-input
DBC swap. The engine accepts native or Jupiter-bridged quotes on active standard
pools (config v0/v1), with SPL Token or supported Token-2022 base mints, including
transfer fees. Active hooks and migrated DAMM pools are unsupported.
`amount` is an integer string: lamports for
buys, base-token units for sells. The quote includes pool, quote mint, minimum
output, context slot and trading/protocol fees as integer strings in `feeMint`.
Use the same browser signing, broadcast and signature tracking flow as Pump.

`client.solana.meteora.dammV2.swap(...)` accepts the same named inputs including
`pool`, and builds an unsigned exact-input DAMM v2 swap. WSOL can be token A or B;
the engine resolves the direction. BothToken, OnlyB and Compounding fees are
supported, with claiming/compounding amounts returned separately in the quote.
SPL Token and supported Token-2022 base mints, including transfer-fee mints, are supported. This builds
against an existing pool; it does not execute a DBC migration or support DAMM v1.

`client.solana.meteora.dammV1.swap(...)` accepts the same public swap inputs and
builds an unsigned constant-product DAMM v1 transaction using SPL Token mints.
WSOL pairs use the native path; other quote assets use the mainnet Jupiter bridge.
The engine reads fresh Dynamic Vault and LP-account state for quotes. Stable/depeg
pools and Token-2022 mints are unsupported. Trading and protocol fees are
returned separately as integer strings in the input `feeMint`. Local browser
signing, broadcast and signature tracking are unchanged.

`client.solana.raydium.launchlab.swap(...)` takes the same public swap inputs
including `pool`. It returns unsigned bytes and a `raydium-launchlab` quote with
protocol/platform/creator fee amounts as integer strings in WSOL. Supports active
native or Jupiter-bridged constant-product and fixed-price curves, SPL Token and
supported Token-2022 base mints, including transfer fees. Expected/minimum outputs
are net of transfer fees. Referral share is 0. Buys exceeding remaining curve supply,
linear curves, active transfer hooks and migrated AMM pools are rejected. Signing
and broadcast use the existing client flow; requests are never auto-replayed.

```ts
const result = await client.solana.broadcastTransaction({
  network: 'solana:mainnet-beta',
  transactions: [signedTransactionBase64],
});
```

Accepts 1..16 signed v1 transactions with unique signatures. The existing broadcaster validates wire format and signatures for the entire batch before sending, then reuses the exact signed bytes for bounded rebroadcast (350 ms, at most 11 attempts per transaction). No preflight simulation is added. A batch contains independent transactions, not an atomic bundle.

Submission routes remain the configured primary RPC, existing mainnet mirrors/Axiom submission and eligible HelloMoon tipped routing. Network configuration and the 64-transaction concurrency limit still apply. `accepted` reports acknowledgement; `processed`/`failed` report observed execution at processed commitment and stop tracking/rebroadcasting, without establishing consensus finality. Submitted/unknown results require tracking. Accepted broadcasts continue after disconnect but are not durable across engine restarts. The SDK never automatically replays requests.

Dependency-free TypeScript clients for Nuxus JSON-RPC 2.0 over WebSocket and HTTP.
The WebSocket transport requires the engine's `nuxus.v2` subprotocol.
WebSocket and HTTP are public; HTTP remains query-only.

## Connection usage

```ts
import { createClient, createHttpClient } from '@nuxus/engine-sdk';

const client = createClient({ url: 'wss://engine.example.com/ws' });
await client.engine.ping();
client.close();

const http = createHttpClient({ url: 'https://engine.example.com/' });
const pong = await http.engine.ping();
```

No `getTicket`, `apiKey` or authentication callback is accepted. The SDK sends
only the `nuxus.v2` WebSocket subprotocol and waits for `engine.connected`.

`createHttpClient` opens no WebSocket. It supports `request` and `batch` for
`engine.ping`, `solana.pump.getLaunchOptions`, `solana.pump.getTokenSettings`,
and `solana.pump.getCharityConfig`. HTTP batch results
preserve input order and individual RPC failures. Pass a signal as the second
argument to request/batch for cancellation. Timeout and cancellation bound both fetch and response parsing, including injected transports.
Default timeout is 15s;
`requestTimeoutMs` and a custom `fetch` can be supplied. Requests never auto-retry,
redirects are rejected, and cookies are omitted. The engine does not enable
cross-origin CORS for this endpoint.

## SOL transfers

```ts
const plan = await client.solana.transfer({
  network: 'solana:devnet',
  sourceAddresses: [sourceAddress],
  destinationAddresses: [destinationAddress],
  amountLamports: '70000000', // Total received; 'max' reserves network fees.
});
// Implement signAndBroadcast with your wallet integration:
const submitted = await signAndBroadcast(plan, (signatures) => {
  // Retain these for status checks before any network submission.
});
for (const tx of submitted.transactions) {
  await client.solana.subscribeSignature({
    network: plan.network,
    signature: tx.signature,
    onUpdate: (outcome) => renderTransactionStatus(outcome.status),
  });
}
```

Sources contribute proportionally to balances, capped by fee-adjusted spendable amounts. Destinations receive equal shares with exact integer remainders. Limits: 16 distinct sources and 16 distinct destinations; source/destination sets cannot overlap. Only ordinary system-owned SOL accounts can fund a transfer. The result includes per-source amounts, destination totals and estimated network fees. Each source pays its own fee and produces one transaction; zero contributors are omitted. Multiple transactions are not atomic.

## WebSocket subscriptions

```ts
import { createClient } from '@nuxus/engine-sdk';

const client = createClient({
  url: 'wss://engine.example.com/ws',
});

const unsubscribe = await client.solana.subscribeSignature({
  signature,
  onUpdate: (result) => renderTransactionStatus(result.status),
  onError: (error) => showError(error.message),
});
unsubscribe();
client.close();
```

Client construction is synchronous and does not open a socket. The first
request/subscription starts one shared connection automatically. Requests wait
for server readiness with a bounded timeout. `start()` optionally connects eagerly
for a UI that displays status before making a request; `close()` (or `stop()`)
cancels pending work, clears subscriptions, and stops reconnects. Explicit new
calls/start can restart that instance. Use a new instance for each user session.

URLs must be ws/wss, without
credentials, query strings, or fragments. Browser WebSocket or Node.js 22+
is required; `createWebSocket` can inject another compatible transport.

## Subscription lifecycle

- Subscribe returns a Promise that resolves with an idempotent unsubscribe
  function after the server acknowledges a subscription ID.
- `onUpdate` receives one processed/failed/unknown execution outcome. Completed watches are not restored. A cached result can arrive before the awaiting caller resumes.
- Callback functions and AbortSignal are local SDK options, never RPC params.
- Pass `signal` to cancel setup or an active subscription. Aborting before
  acknowledgement rejects with `aborted`; a late server ID is released.
- Every reconnect opens a public connection and re-registers active subscriptions
  with bounded concurrency (four setup calls, or opt-in batches). Server IDs change; callbacks and unsubscribe handles remain stable.
- Unsubscribe while disconnected removes the local registration, preventing
  resubscribe. Updates for stale IDs or duplicate/older sequences are ignored.
- Server-rejected subscriptions report onError and are removed. Initial setup
  failures also reject the Promise; callers should handle that rejection.
- There is no historical replay/backfill guarantee. Check connection status to
  mark previously displayed values stale.
- Pending signature watches are restored after reconnect; sent transactions are never replayed.

React cleanup without an asynchronous effect:

```ts
useEffect(() => {
  const controller = new AbortController();
  void client.solana
    .subscribeSignature({
      signature,
      onUpdate: setTransactionStatus,
      signal: controller.signal,
    })
    .catch((error) => {
      if (!controller.signal.aborted) reportError(error);
    });
  return () => controller.abort();
}, [client, signature]);
```

Native/token balance query helpers, subscriptions and DTOs have moved to
[@nuxus/data-sdk](https://github.com/nuxus-org/nuxus-sdk/tree/main/typescript/data-sdk), alongside Binance prices. Use its
authenticated data endpoint. Engine retains transaction building, broadcast,
signature confirmation/recovery.

## JSON-RPC requests and batches

`client.engine.ping()` calls `engine.ping`. Transaction builders/broadcasts are
WebSocket-only; HTTP request/batch accepts `engine.ping` and the read-only Pump
`getLaunchOptions`, `getTokenSettings` and `getCharityConfig` methods.

```ts
const result = await client.request<{ serverTimeMs: number }>({
  method: 'engine.ping',
});
const results = await client.batch([
  { method: 'engine.ping' },
  { method: 'engine.ping' },
]);
// Results preserve input order: {status:'fulfilled',value} or
// {status:'rejected',reason:EngineError}. Server response ordering may differ.
```

Use the subscription helpers for managed subscriptions; raw request/batch calls
do not register callback or resubscribe state. Generic result types are caller
supplied: JSON-RPC envelopes are validated at runtime, domain payloads are not.

Remote EngineError.code is a JSON-RPC integer; optional server metadata is in
error.data. Local transport/lifecycle errors have string codes. No sent request
is automatically replayed after disconnection, even if its response is lost.

## Connection settings

Statuses: idle, connecting, connected, reconnecting, stopped.
Use `client.onStatusChange(listener)` and `client.getSnapshot()`.
The server's `engine.connected` notification marks readiness, not socket open.

Defaults: handshake timeout 15 seconds; request timeout 15 seconds;
retry delay 1–30 seconds exponential backoff with jitter; heartbeat
`engine.ping` every 30 seconds. Set heartbeatIntervalMs to 0 to disable it.
Waiting calls time out after connectionTimeoutMs. Initial subscription setup
is bounded by connectionTimeoutMs + requestTimeoutMs.
Maximums: 100 subscriptions, 32 pending requests, 32 calls per batch.
Each browser tab owns its own client/socket.

## Signature confirmations

Subscribe explicitly after signing/broadcasting yields a transaction signature:
`client.solana.subscribeSignature({ signature, network?, onUpdate, onError?, onSubscribed?, signal?, batch? })`.
The wire methods remain `solana.signatureSubscribe` and `solana.signatureUnsubscribe`;
notifications use `solana.signatureNotification`. Commitment is processed. The
engine ACK precedes every notification, including a cached outcome. The result is
one-shot (`processed`, `failed` or `unknown`); `unknown` does not mean failed.
Processed execution, including an observed error, does not establish finality.
Pending watches are restored on SDK reconnect, completed ones are released.
After each upstream subscription ACK, engine performs one history status lookup
against that provider while listening to WebSocket notifications. Reconnect repeats
that single lookup; it never polls. A missing/malformed result or HTTP failure
leaves the live watch active. History at processed or stronger commitment satisfies
the watch. Processed/failed outcomes are cached; `unknown` can
be explicitly retried with another `subscribeSignature` call and a fresh deadline.
The engine watch expires after 120 seconds without an observed terminal result.
The broadcaster reads cached client-subscription outcomes to stop unnecessary
rebroadcasts; it does not create a signature subscription itself.

## Token creation

`client.solana.createToken({ platform: 'pump', ...options })` builds Pump create_v2
plus optional creator buy, accepts inline `metadata: { name, symbol, image, website?, description?, twitter?, telegram? }`
(`image_url` can replace `image`), or published `metadata: { name, symbol, uri }`,
and returns unsigned bytes with a detached mint signature. Use
`client.solana.pump.createToken(options)` without `platform` to call Pump directly.
Inline fields are queued by the engine through its private API connection;
clients never call a metadata write endpoint or receive backend credentials.
The API returns the reserved URI before its background R2 upload completes, so a
prepared result does not guarantee that the URI is already readable.

`options.pump` accepts `quoteMint`, `creatorFeeBps`, `mayhem`, `holderRewards`
and wallet/GitHub/X/charity `feeRecipients`; shares total 10,000 basis points.
`slippageBps` defaults to 100 for non-SOL quote bridges. Read live capabilities
with `client.solana.pump.getLaunchOptions({ network })`, copy source settings
with `getTokenSettings({ network, mint })`, and inspect selected charity configs
with `getCharityConfig({ configId, network })`. Charity search belongs to the
Search Worker, not the Engine SDK. Instant migration/bundles are deferred.

`client.solana.pump.createOffchainToken({ network, creator, metadata, auth })`
registers a standard SOL Pump.fun page without building or broadcasting a
transaction. `auth` contains a fresh millisecond `timestamp` and the base58
Ed25519 signature of exactly `Sign in to pump.fun: ${timestamp}`, signed locally
by `creator`. It returns `{ status: 'offchain', network, mint, metadataUri, url }`.
Do not pass session cookies or wallet private keys. No automatic write replay
occurs after timeout/disconnect. Live Pump session access remains unverified
(HTTP 403 in development); advanced offchain modes are not supported.

## Transaction format and swap methods

Use an engine deployment compatible with these transaction types. Transaction builds and broadcast
accept only v1 (4096-byte maximum); legacy/v0 wires are rejected. The v1 message
precedes its signatures. Priority fees keep the existing caller-facing units, but
are encoded as exact total lamports in message config. No ALT setup is required.

`client.solana.pump.amm.swap({ address, pool, mint, side, amount, slippageBps,
priorityFeeLamports?, bribeFeeLamports?, network? })` builds migrated Pump AMM
SOL/WSOL swaps. It returns unsigned bytes and a `pump-amm` quote with integer-string
output and LP/protocol/creator fee amounts. The engine resolves boosted reserves,
fee schedules and v2/cashback-v1 instructions from chain state. Sign using the
existing browser wallet flow and broadcast separately; reconnect never replays a
build request. `client.solana.pump.swap` remains the bonding-curve method.

`client.solana.raydium.cpmm.swap({ address, pool, mint, side, amount, slippageBps,
priorityFeeLamports?, bribeFeeLamports?, network? })` builds unsigned SOL/WSOL
CPMM swaps in either mint order, including LaunchLab graduates. The
`raydium-cpmm` quote reports trade/protocol/fund fees in `feeMint` and creator
fees in `creatorFeeMint` (possibly the output mint). Protocol/fund fees are
included in the trade fee, not added on top. All amounts are integer strings.
The engine validates pool state and computes program-compatible quotes; the
browser signs and broadcasts separately, without request replay on reconnect.

`client.solana.meteora.dlmm.swap({ address, pool, mint, side, amount, slippageBps,
priorityFeeLamports?, bribeFeeLamports?, network? })` builds unsigned exact-input
SOL/WSOL DLMM swaps with the official Rust SDK. The engine resolves both mint
orders, dynamic fees, fee collection mode and fresh initialized bin arrays.
`meteora-dlmm` quotes include `binArrayCount`, integer-string outputs and fees;
`feeMint` is the actual fee token. The eight-array bound rejects trades it cannot
fully quote. Sign and broadcast separately using the existing browser flow.
USDC-paired pools such as FRONTIER are outside this method's current scope.
