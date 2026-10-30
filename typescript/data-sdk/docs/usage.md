# Data SDK usage

## WebSocket usage

This browser example assumes an existing API session. Token issuance belongs to
the API; the SDK accepts a callback and does not own login or cookie storage.

```ts
import { createClient, type BinancePriceSnapshot } from '@nuxus/data-sdk';

const client = createClient({
  url: 'wss://data.example.com/',
  getToken: async ({ signal }) => {
    const response = await fetch('https://api.example.com/data/token', {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    if (!response.ok) throw new Error('Token unavailable');
    const { token } = await response.json();
    return token;
  },
});

const unsubscribe = await client.binance.subscribePrice({
  stream: 'ethusdt@miniTicker',
  onUpdate: (price: BinancePriceSnapshot) => {
    // Exact decimal string or null. Check status before treating it as live.
    console.log(price.price, price.status);
  },
  onSubscribed: (subscriptionId) => {
    // Called initially and after each reconnect acknowledgement.
  },
  onError: (error) => console.error(error.code, error.message),
});

const snapshot = await client.binance.getPrice({
  stream: 'ethusdt@miniTicker',
});
const pong = await client.ping(); // 'pong'

unsubscribe(); // Idempotent, immediately stops local callbacks.
client.close();
```

Only lowercase `<symbol>@miniTicker` streams are currently supported. Symbols
include the complete Binance pair, such as `ethusdt` or `ethbtc`. There is no
generic cross-provider price format: `BinancePriceSnapshot` is Binance-specific.

`binance.getPrice` reads the current gateway snapshot without creating upstream
demand. A missing worker reports `unavailable`; an inactive stream or one without
a tick may be `waiting`. Other statuses are `live`, `stale`, and `rejected`.
An upstream acknowledgement alone does not prove that a symbol exists.

The SDK preserves price strings and validates gateway response/notification
payloads before delivering them. It does not convert prices to floating point.

## Authentication and connection lifecycle

- Construction is synchronous and performs no IO. A query or subscription starts
  one shared socket lazily. Call `start()` for an eager connection/status display.
- `getToken({signal})` runs **before** opening each socket, including reconnects.
  The first WebSocket RPC is a standalone `authenticate` request. Readiness is
  its `true` response, not `engine.connected` or merely a socket-open event.
- Return a valid JWT string. The callback can keep an unexpired token in memory.
  Do not put tokens in URLs or persistent SDK storage. The SDK never logs tokens
  and sanitizes token-supplier and authentication errors.
- A token-supplier failure or rejected credentials stops the client. Recover the
  application session, then call `start()` or make a new call. Temporary gateway
  authentication/connection-limit failures retry with backoff and jitter.
- The gateway keeps an authenticated WebSocket authorized after JWT expiry.
  The SDK does not re-authenticate that socket. HTTP requests and new connections
  require a valid token. Call `close()` on logout/session changes and use a fresh
  client for another user; the SDK cannot infer session revocation.
- `close()` / `stop()` cancel pending work, clear subscriptions, close the socket,
  and stop retries. A later explicit call or `start()` can restart the instance.

Observe connection state:

```ts
const removeListener = client.onStatusChange(() => {
  const { status, connectionVersion, error } = client.getSnapshot();
  // status: idle | connecting | authenticating | connected | reconnecting | stopped
});
removeListener();
```

`connectionVersion` is a local counter incremented after each successful
authentication. It is not a server-generated ID. Mark displayed values stale
while disconnected; the SDK does not mutate previously delivered snapshots.

## Subscription lifecycle

`subscribePrice` resolves to an unsubscribe function after gateway acknowledgement.
That acknowledgement confirms gateway demand registration, not a first Binance
tick. The initial notification may run before the awaiting caller resumes.

- Active subscriptions are automatically registered again after reconnect, with
  new server IDs and stable local callbacks/unsubscribe handles.
- Each reconnect delivers a fresh gateway snapshot. There is no historical
  replay or guarantee of every intermediate tick.
- Old server IDs and duplicate/out-of-order sequences are ignored.
- Duplicate local subscriptions to one stream are rejected. Share a single
  subscription in the consuming application when multiple components need it.
- Server-rejected registrations call `onError` and are removed. Initial failures
  also reject the setup Promise. Transient connection recovery is exposed through
  connection status rather than replaying ordinary queries.
- Aborting before acknowledgement rejects setup; a late remote ID is released.
  If setup/unsubscribe times out after being sent, the connection is recycled to
  clean up uncertain server resources. Other active subscriptions are restored.
- Application callback exceptions are isolated from other subscriptions.

React-compatible cleanup (the package itself has no React dependency):

```ts
useEffect(() => {
  const controller = new AbortController();
  void client.binance
    .subscribePrice({
      stream: 'solusdt@miniTicker',
      signal: controller.signal,
      onUpdate: setPrice,
    })
    .catch((error) => {
      if (!controller.signal.aborted) reportError(error);
    });
  return () => controller.abort();
}, [client]);
```

## HTTP queries and batches

```ts
import { createHttpClient } from '@nuxus/data-sdk';

const http = createHttpClient({
  url: 'https://data.example.com/',
  getToken: async ({ signal }) => getValidDataToken(signal),
});

const result = await http.binance.getPrice({ stream: 'btcusdt@miniTicker' });
const results = await http.batch([
  { method: 'ping' },
  { method: 'binance.getPrice', params: { stream: 'btcusdt@miniTicker' } },
]);
```

Implement `getValidDataToken` in your session integration. HTTP calls invoke the
supplier each time; reuse an unexpired token in memory instead of issuing a new
API token for every price read. The API limits token issuance separately.

HTTP sends Bearer authorization, omits cookies, rejects redirects, and never
auto-retries a request. A 401 is reported to the caller. Timeout/AbortSignal cover
token lookup, fetch, and response parsing. Provide `{signal}` as the second
argument to query helpers, `request`, or `batch` for cancellation.

Both clients expose typed `request({method, params?})` and `batch([...])` for
`ping`, `binance.getPrice`, `solana.getNativeBalances`,
`solana.getTokenBalances`, and `pumpfun.getCallouts`. Authentication and subscription methods are managed
by the WebSocket lifecycle and are rejected by the raw query APIs. `batch` results
preserve input order as `{status:'fulfilled', value}` or
`{status:'rejected', reason: DataError}`.

WebSocket batches may be split across several frames to respect the local send
budget. HTTP batches use one request and have no local pacing; each entry counts
against the server's account-wide budget and can return a rate-limit error.

## Defaults and limits

| Setting                                       | Default                                          |
| --------------------------------------------- | ------------------------------------------------ |
| `connectionTimeoutMs`                         | 15,000; includes token lookup and authentication |
| `requestTimeoutMs`                            | 15,000; includes WebSocket queue wait            |
| `subscriptionTimeoutMs`                       | 30,000 for initial subscription setup            |
| `reconnectMinDelayMs` / `reconnectMaxDelayMs` | 1,000 / 30,000, plus up to 20% jitter            |
| `heartbeatIntervalMs`                         | 30,000; set 0 to disable                         |
| `requestsPerSecond`                           | 10 per WebSocket client                          |

The WebSocket budget includes authentication, ping, unsubscribe, and every entry
in an automatically coalesced batch. The gateway currently defaults to 20 calls
per account per second, shared across clients/transports. Local pacing cannot
guarantee that a shared account stays below that limit; reduce the budget for
multiple simultaneous clients. Low send budgets may require longer setup/request
timeouts when restoring many subscriptions.

Limits: 100 active/pending subscriptions per Binance/Solana manager, one callout subscription, 256 queued/in-flight RPCs, 32 in-flight
RPCs, and 32 entries per public batch. Errors returned by the gateway keep numeric
JSON-RPC codes; local errors use string codes. No sent query is replayed after
connection loss.

## Solana balances

Both clients expose `solana.getNativeBalances({ addresses, network?, commitment? })`
and `solana.getTokenBalances({ addresses, mint, network?, commitment? })`.
Mainnet (`solana:mainnet-beta`) and devnet (`solana:devnet`) are supported;
mainnet and `finalized` are the defaults. Queries accept 1..100 distinct wallet
addresses. `baseUnits` always remains a decimal string (u64); convert with BigInt,
not Number. Token responses describe only the canonical ATA, support Token and
Token-2022, and include decimals, existence, frozen state and token program.
Missing accounts are zero with `exists: false`; infrastructure errors reject.

```ts
const stop = await client.solana.subscribeBalance({
  network: 'solana:devnet',
  address: wallet,
  initialSnapshot: false,
  onSubscribed: () => {
    /* Also called on gateway reconnect; refetch the bulk snapshot. */
  },
  onUpdate: (balance) => render(balance.amount.baseUnits),
  onUnavailable: () => markLastValueStale(),
  onError: (error) => reportFailedSubscription(error),
  signal: controller.signal,
});
const snapshot = await client.solana.getNativeBalances({
  network: 'solana:devnet',
  addresses: [wallet],
});
// Merge by slot: a live notification wins a tie against this snapshot.
stop();
```

`solana.subscribeTokenBalance` takes `address`, `mint`, and the same callbacks.
It is stream-only: subscribe before querying the bulk snapshot. Native subscribe
sends an initial snapshot by default. The gateway ACK waits for worker readiness.
All subscriptions use the SDK's paced/batched request queue automatically;
there is no per-call `batch` flag. There are separate 100-subscription capacities
for Binance and Solana on a socket. Network/commitment/wallet/mint combinations
identify Solana watches; duplicate local watches are rejected.

`onUnavailable` marks temporary worker/upstream/Redis failure. It does not cancel
the subscription; a subsequent `onUpdate` restores freshness on the same socket.
`onError` reports terminal setup errors. Older slots and duplicate/out-of-order
sequences are ignored. On gateway reconnect, subscriptions receive new IDs and
`onSubscribed` fires again; stream-only consumers should refetch their snapshot.

## Pump.fun callouts

Use the same authenticated DataClient for callouts and existing subscriptions:

```ts
const stop = await client.pumpfun.subscribeCallouts({
  onUpdate(update) {
    if (update.type === 'callout') renderCallout(update.callout);
    else renderStatus(update.status);
  },
  onSubscribed() {
    // Runs again after reconnect. Merge by calloutId with the live stream.
    void client.pumpfun.getCallouts({ limit: 50 }).then(mergeRecentCallouts);
  },
  onError(error) {
    reportFeedError(error);
  },
  signal: controller.signal,
});
// Later: stop();
```

`pumpfun.getCallouts` is also available on DataHttpClient and in typed
request/batch queries. Limit defaults to 50 (range 1–50). Results contain
`{ callouts, status }`; status reflects the upstream worker, independently of
the gateway socket connection. Status notifications do not end the subscription.
One local callout subscription per client is supported; duplicate setup rejects
with `duplicate_subscription`, matching the other provider helpers.

Subscriptions restore after reconnect and filter stale IDs/sequences. Callout IDs
are stable across cached queries and notifications; consumers merge those IDs.
This is a bounded recent/live feed, without historical or lossless replay.
