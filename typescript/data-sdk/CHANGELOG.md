# Changelog

## 0.1.0-alpha.2 — 2026-10-31

### Release

- Publish through GitHub Actions using npm Trusted Publishing (OIDC) and provenance
  to validate this package's initial trusted publisher configuration.
- Update package documentation for published SDK installation and include the
  finalized alpha.1 release date.

The SDK runtime and public API are unchanged from `0.1.0-alpha.1`.

## 0.1.0-alpha.1 — 2026-10-30

Initial public alpha of `@nuxus/data-sdk`.

### Added

- Authenticated HTTP and WebSocket clients with a caller-supplied data JWT callback.
- Binance price queries/subscriptions, Solana native/token balance queries and
  subscriptions, and Pump.fun callout queries/subscriptions.
- Paced WebSocket requests, query batches, cancellation, reconnect, subscription
  restoration, and stale sequence/slot filtering.
- Runtime response validation, exact decimal/base-unit strings, sanitized
  authentication errors, and structured `DataError` values.
- Compiled ESM exports, TypeScript declarations, usage documentation, and MIT license.

### Compatibility

- Supports browsers and Node.js 22+ with native or injected transports.
- Requires a compatible Nuxus data gateway and a valid `data:read` JWT.
- Live data availability depends on the gateway's configured workers/providers.
  Subscriptions do not guarantee historical or lossless replay.
- Alpha interfaces may change before a stable release.
