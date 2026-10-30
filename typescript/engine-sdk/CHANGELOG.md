# Changelog

## 0.1.0-alpha.2 — 2026-10-31

### Release

- Publish through GitHub Actions using npm Trusted Publishing (OIDC) and provenance
  to validate this package's initial trusted publisher configuration.
- Update package documentation for published SDK installation and include the
  finalized alpha.1 release date.

The SDK runtime and public API are unchanged from `0.1.0-alpha.1`.

## 0.1.0-alpha.1 — 2026-10-30

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
