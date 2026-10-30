# @nuxus/data-sdk 0.1.0-alpha.1

The first public alpha provides framework-independent TypeScript clients for
authenticated Nuxus data queries and subscriptions.

## Installation

```sh
npm install @nuxus/data-sdk@0.1.0-alpha.1
```

The prerelease distribution tag is `alpha`. The package ships compiled ESM and
TypeScript declarations, has no runtime dependencies, and is licensed under MIT.
Browser and Node.js 22+ transports are supported.

## Included

- Binance price queries and subscriptions with exact decimal strings.
- Solana native/token balance queries and subscriptions with exact base units.
- Pump.fun callout queries, subscriptions, and provider status updates.
- Caller-supplied JWT authentication, HTTP Bearer queries, WebSocket authentication,
  query batches, cancellation, request pacing, and subscription restoration.
- Runtime validation, stale sequence/slot filtering, and sanitized auth errors.

The SDK accepts a `getToken` callback and leaves login and token storage to the
application. Close the client when changing user sessions.

## Validation

Automated checks cover runtime behavior, public types, package contents, and
independently installed package consumers on Node.js 22 and 24. Local smoke tests
verified API-issued JWTs, HTTP/WebSocket queries, invalid/expired/scope rejection,
live Binance updates, Solana balances, reconnect, and subscription cleanup.

## Alpha limitations

- Interfaces may change before a stable release.
- Live data depends on compatible gateway workers and upstream availability.
- Pump.fun query/subscription transport and status delivery were verified, but
  live callout delivery remains unverified: its upstream returned HTTP 403 during
  the local smoke test. Consumers must handle `disconnected` and degraded states.
- Streams provide recent/live updates without historical or lossless replay.

See the [package documentation](https://github.com/nuxus-org/nuxus-sdk/tree/main/typescript/data-sdk)
for authentication, lifecycle behavior, provider details, and limits.
