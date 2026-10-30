# @nuxus/engine-sdk

TypeScript clients for Nuxus transaction preparation, signed transaction
broadcasting, and signature tracking. Framework independent, ESM, and zero
runtime dependencies. Supports browsers and Node.js 22+ with native WebSocket
and fetch, or injected transports.

Prerelease versions are available on npm under the `alpha` distribution tag.

See the [changelog](CHANGELOG.md) for release history.

## Installation

```sh
npm install @nuxus/engine-sdk@alpha
```

## Quick start

```ts
import { createClient } from '@nuxus/engine-sdk';

const client = createClient({ url: 'wss://engine.example.com/ws' });

try {
  const { connectionId } = await client.engine.ping();
  console.log(connectionId);
} finally {
  client.close();
}
```

Construction opens no socket. The first call starts one shared connection and
waits for the `engine.connected` handshake. `start()` connects eagerly;
`close()` cancels pending work and subscriptions and stops reconnecting.

## Transactions

Build methods return unsigned transactions. Your wallet integration signs those
bytes locally, then submits the signed transactions with
`client.solana.broadcastTransaction`. The SDK does not store wallet keys or
require Turnkey.

| API                                                                 | Purpose                                         |
| ------------------------------------------------------------------- | ----------------------------------------------- |
| `solana.transfer`                                                   | Build SOL transfers using exact lamport strings |
| `solana.associatedTokenAccount.createIdempotent`                    | Build a token account creation                  |
| `solana.createToken`                                                | Build Pump, Bonk, or Stonk token creation       |
| `solana.pump`, `solana.jupiter`, `solana.meteora`, `solana.raydium` | Platform-specific builders and reads            |
| `solana.simulateTransaction`                                        | Simulate unsigned bytes without broadcasting    |
| `solana.broadcastTransaction`                                       | Submit already signed transactions              |
| `solana.subscribeSignature`                                         | Observe one processed/failed/unknown outcome    |

Sent requests are never automatically replayed after a disconnect. A lost
response does not prove that a write failed. Keep signed transaction signatures
and reconcile their status before submitting again. Processed execution is not
consensus finality.

Amounts in base units remain strings. JSON-RPC envelopes are validated at runtime;
generic query result types and engine domain payloads require application validation.

## HTTP and errors

`createHttpClient({ url })` provides query-only HTTP access for `engine.ping`
and the Pump launch-options, token-settings, and charity-config reads. It rejects
write/subscription methods, omits cookies, and rejects redirects. Both request
and batch accept `{ signal }`; timeouts cover fetch and response parsing.

`EngineError` exposes `code`, `message`, `retryable`, and optional `data`.
Local codes are strings; server JSON-RPC codes are integers. `retryable` describes
an error and never authorizes automatic replay of a write.

See [usage and protocol details](docs/usage.md) for signing, subscription cleanup,
HTTP batches, transport options, defaults, and platform capabilities.

## Development

From the repository root:

```sh
pnpm --filter @nuxus/engine-sdk run check-types
pnpm --filter @nuxus/engine-sdk run lint
pnpm --filter @nuxus/engine-sdk run test
pnpm --filter @nuxus/engine-sdk pack --out /tmp/nuxus-engine-sdk.tgz
```

Packed exports contain compiled ESM and declarations. Linked development
checkouts may resolve source using the `development` condition.

Licensed under [MIT](LICENSE).
