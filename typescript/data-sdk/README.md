# @nuxus/data-sdk

Authenticated TypeScript clients for Nuxus data queries and live subscriptions.
Framework independent, ESM, and zero runtime dependencies. Supports browsers and
Node.js 22+ with native WebSocket and fetch, or injected transports.

The initial release version is **0.1.0-alpha.1**, under the `alpha` distribution
tag. The package is being prepared for publication.

## Installation

After publication:

```sh
npm install @nuxus/data-sdk@alpha
```

## Quick start

Supply a valid data JWT from your application's authentication integration.
The SDK calls `getToken` before every new connection, including reconnects.

```ts
import { createClient } from '@nuxus/data-sdk';

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

const controller = new AbortController();
await client.binance.subscribePrice({
  stream: 'solusdt@miniTicker',
  signal: controller.signal,
  onUpdate: ({ price, status }) => console.log(price, status),
  onError: (error) => console.error(error.code, error.message),
});

// When the view closes:
controller.abort();
client.close();
```

Construction opens no socket. Ordinary calls connect lazily and wait for
authentication. `start()` connects eagerly. Close the client on logout or identity
changes and create a fresh instance for another session.

## Available data

| Namespace | Queries                                 | Subscriptions                               |
| --------- | --------------------------------------- | ------------------------------------------- |
| `binance` | `getPrice`                              | `subscribePrice`                            |
| `solana`  | `getNativeBalances`, `getTokenBalances` | `subscribeBalance`, `subscribeTokenBalance` |
| `pumpfun` | `getCallouts`                           | `subscribeCallouts`                         |

Prices and on-chain base-unit amounts remain strings. Response payloads are
validated before delivery. Active subscriptions restore after reconnect and
ignore stale IDs/sequences; they do not provide historical or lossless replay.
Use connection and provider status to detect stale values.

## HTTP and errors

`createHttpClient({ url, getToken })` exposes the same queries, plus `request`
and `batch`. HTTP sends Bearer authorization, omits cookies, rejects redirects,
and never automatically retries. Pass `{ signal }` to cancel a query; timeout
covers token lookup, fetch, and response parsing.

`DataError` exposes `code`, `message`, `retryable`, and optional `data`.
Local codes are strings; server JSON-RPC codes are integers. Token-supplier and
authentication errors are sanitized. The SDK owns no login flow or token storage.

See [usage and protocol details](docs/usage.md) for subscription cleanup,
batching, authentication, transport options, defaults, and provider behavior.

## Development

From the repository root:

```sh
pnpm --filter @nuxus/data-sdk run check-types
pnpm --filter @nuxus/data-sdk run lint
pnpm --filter @nuxus/data-sdk run test
pnpm --filter @nuxus/data-sdk pack --out /tmp/nuxus-data-sdk.tgz
```

Tests use mock transports and public contract types; no private core checkout
is required. Packed exports contain compiled ESM and declarations.

Licensed under [MIT](LICENSE).
