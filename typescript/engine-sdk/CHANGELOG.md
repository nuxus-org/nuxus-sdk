# Changelog

## 0.1.0-alpha.1 — Unreleased

Initial public alpha of `@nuxus/engine-sdk`.

### Added

- Typed WebSocket clients for SOL transfers, token accounts, token creation,
  swaps, unsigned simulation, signed transaction broadcasting, and signature
  observations.
- Query-only HTTP clients for engine ping and Pump launch options, token settings,
  and charity configuration.
- Connection snapshots, heartbeat, bounded reconnects, request batches,
  cancellable subscriptions, and restoration of active watches.
- Structured `EngineError` values and exact base-unit string types.
- Compiled ESM exports, TypeScript declarations, usage documentation, and MIT license.

### Compatibility

- Requires a compatible `nuxus.v2` engine and its v1 transaction format.
- Supports browsers and Node.js 22+ with native or injected transports.
- Wallet signing belongs to the consuming application. Sent requests are never
  automatically replayed; processed signature observations do not establish finality.
- Alpha interfaces may change before a stable release.
