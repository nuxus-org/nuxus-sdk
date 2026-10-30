# Nuxus SDK

Official multi-language SDKs for Nuxus: Solana transaction preparation,
broadcasting, and real-time data streams.

SDKs will be organized by language, with independent packages, examples,
tests, and releases. Wallet providers such as Turnkey will be optional.

The TypeScript engine and data SDKs have been migrated from `nuxus-core`.
Both packages start at `0.1.0-alpha.1` and use the `alpha` distribution tag.
They are being prepared for their first registry publication.

## Repository layout

```text
typescript/
  engine-sdk/    @nuxus/engine-sdk
  data-sdk/      @nuxus/data-sdk
```

Other language SDKs will be added when needed. Wallet signing and Turnkey
integrations are not required by these clients.

## Development

Use Linux/WSL, Node.js `24.10.0`, and pnpm `11.22.0`.

```sh
nvm use
pnpm install --frozen-lockfile
pnpm build
pnpm check-types
pnpm lint
pnpm test
pnpm format:check
```

`pnpm dev` watches both SDKs and rebuilds their output. Build before using a
locally linked SDK in another repository. Tests use mock transports and do not
need a running API, engine, data service, or private core checkout.

Contributor guide: [SDK architecture](docs/architecture.md).

Package documentation:

- [Engine SDK](typescript/engine-sdk/README.md)
- [Data SDK](typescript/data-sdk/README.md)

To inspect a distribution archive without publishing:

```sh
pnpm --filter @nuxus/engine-sdk pack --out /tmp/nuxus-engine-sdk.tgz
pnpm --filter @nuxus/data-sdk pack --out /tmp/nuxus-data-sdk.tgz
```

Each archive contains compiled ESM, TypeScript declarations, its README, usage documentation, license,
and package metadata. Publishing is a separate step.

## Scope

| Component                  | Scope                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Engine SDK                 | HTTP/WebSocket clients, public transaction request/result types, broadcasting, and signature tracking |
| Data SDK                   | Authenticated HTTP/WebSocket clients, public data types, queries, and subscriptions                   |
| Other languages            | Future SDKs with independent packages, tests, and releases                                            |
| Examples and documentation | Standalone integrations using public SDK interfaces                                                   |

SDKs must build and test without a private `nuxus-core` checkout. Server/SDK
contract conformance checks that import backend internals remain in core's
`packages/sdk-contracts` package.

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
