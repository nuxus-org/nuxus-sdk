# @nuxus/engine-sdk 0.1.0-alpha.1

The first public alpha provides framework-independent TypeScript clients for
Nuxus transaction preparation, broadcasting, and signature tracking.

## Installation

```sh
npm install @nuxus/engine-sdk@0.1.0-alpha.1
```

The prerelease distribution tag is `alpha`. The package ships compiled ESM and
TypeScript declarations, has no runtime dependencies, and is licensed under MIT.
Browser and Node.js 22+ transports are supported.

## Included

- Typed builders for SOL transfers, associated token accounts, Pump/Bonk/Stonk
  token creation, and supported Pump, Jupiter, Meteora, and Raydium swaps.
- Explicit unsigned transaction simulation, signed transaction broadcasting, and
  one-shot signature observations.
- HTTP reads for engine ping and Pump launch options, token settings, and charity
  configuration.
- Batches, connection state, heartbeat/reconnect, subscription cancellation, and
  restoration of active subscriptions.

The application supplies its own wallet signer. Exact on-chain amounts remain
strings. Requests already sent are never automatically replayed after a timeout
or disconnect.

## Validation

Automated checks cover runtime behavior, public types, package contents, and
independently installed package consumers on Node.js 22 and 24. Local smoke tests
against running Nuxus services verified HTTP/WebSocket requests, subscription
reconnect, unsigned SOL transfer/ATA preparation, and unsigned transfer simulation.
Live wallet signing and transaction broadcasting were not exercised.

## Alpha limitations

- Interfaces may change before a stable release.
- The backend must support `nuxus.v2` and the documented v1 transaction format.
- Processed signature observations are execution observations, not consensus finality.
- Generic request result types do not validate domain payloads at runtime.

See the [package documentation](https://github.com/nuxus-org/nuxus-sdk/tree/main/typescript/engine-sdk)
for transport options, lifecycle behavior, and supported platform capabilities.
