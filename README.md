# Nuxus SDK

Official multi-language SDKs for Nuxus: Solana transaction preparation,
broadcasting, and real-time data streams.

SDKs will be organized by language, with independent packages, examples,
tests, and releases. Wallet providers such as Turnkey will be optional.

This is an initial scaffold. Existing SDKs will be migrated from `nuxus-core`.

## Scope

| Component                  | Scope                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Engine SDK                 | HTTP/WebSocket clients, public transaction request/result types, broadcasting, and signature tracking |
| Data SDK                   | Authenticated HTTP/WebSocket clients, public data types, queries, and subscriptions                   |
| Other languages            | Future SDKs with independent packages, tests, and releases                                            |
| Examples and documentation | Standalone integrations using public SDK interfaces                                                   |

The first migration will bring the existing TypeScript engine and data SDKs here.
SDKs must build and test without a private `nuxus-core` checkout. Server/SDK
contract conformance checks that import backend internals will remain in core.

Transaction-building implementations, backend services, data workers, and the
official web app remain in `nuxus-core`. Client applications, shared UI, wallet
signing, and optional provider adapters belong in `nuxus-app`. SDKs accept caller
authentication and signed transactions without requiring Turnkey.

## License

Nuxus-authored code in this repository is licensed under the [MIT License](LICENSE).
Copyright (c) 2026 [nuxus-org](https://github.com/nuxus-org).

Commercial use, modification, redistribution, and closed-source forks are allowed
under the license terms, including preservation of the copyright and permission
notice. Contributions are provided under the same license unless explicitly
agreed otherwise.

Third-party dependencies and assets retain their own licenses. This repository's
license does not relicense those materials or code remaining in `nuxus-core`.
Each published SDK package must include the MIT license and any required
third-party notices.

The code license does not grant access to Nuxus-hosted services or third-party
APIs and data. Those services have their own authentication and usage terms.
