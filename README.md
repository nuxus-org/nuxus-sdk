# Nuxus SDK

Official multi-language SDKs for Nuxus: Solana transaction preparation,
broadcasting, and real-time data streams.

SDKs will be organized by language, with independent packages, examples,
tests, and releases. Wallet providers such as Turnkey will be optional.

The TypeScript engine and data SDKs have been migrated from `nuxus-core`.
Both packages start at `0.1.0-alpha.1` and use the `alpha` distribution tag.
They are being prepared for their first registry publication.

Prepared release notes and package changelogs are listed in
[Release notes](docs/releases/README.md).

## Repository layout

```text
typescript/
  engine-sdk/    @nuxus/engine-sdk
  data-sdk/      @nuxus/data-sdk
```

Other language SDKs will be added when needed. Wallet signing and Turnkey
integrations are not required by these clients.

## Development

Use Linux/WSL, Node.js `24.10.0`, pnpm `11.22.0`, and Gitleaks `8.30.1`.
The CLI version is pinned in `.gitleaks-version`; local hooks and CI should use
that version. Download the matching binary from the
[official release](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1),
verify its SHA-256 against the release checksums, and place it on `PATH`.
Gitleaks is a development tool; published SDKs do not require it.

On Linux x64, the checksum-verified installer can place the CLI in a directory
of your choice:

```sh
bash scripts/install-gitleaks.sh ~/.local/bin
```

Ensure that directory is on `PATH` before running hooks or tooling tests.

```sh
nvm use
pnpm install --frozen-lockfile
gitleaks version
pnpm build
pnpm check-types
pnpm lint
pnpm test
pnpm format:check
pnpm check:secrets
```

`pnpm dev` watches both SDKs and rebuilds their output. Build before using a
locally linked SDK in another repository. Tests use mock transports and do not
need a running API, engine, data service, or private core checkout.

Git hooks install automatically during a development `pnpm install`. Run
`pnpm hooks:install` to reinstall them. Hook installation is skipped in CI,
production, when `HUSKY=0`, or when Git metadata is absent.

- `pre-commit` scans the staged diff with Gitleaks before running Prettier and
  ESLint. Missing or mismatched CLI versions block the commit. Checks do not fix
  files automatically, and preserve unstaged edits. Type-test files remain covered
  by the type checker; generated lockfile formatting is preserved.
- `pre-push` runs `pnpm check-types` for both SDKs.
- `pnpm test:tooling` tests the hooks in temporary Git repositories, including
  local-only pushes. `pnpm test` includes these checks before SDK runtime tests.

Root `pnpm lint` also checks the hook installer and tooling tests. Full builds,
runtime tests, and distribution checks are run separately from Git hooks.

`pnpm check:secrets:staged` scans staged changes; `pnpm check:secrets` scans Git
history across all local refs, including secrets removed in later commits. Both
redact findings and return a nonzero exit code on findings or scanner errors.
Pre-commit checks do not scan unstaged or untracked files. Tooling tests require
the pinned CLI and use synthetic credentials in temporary repositories.

Contributor guide: [SDK architecture](docs/architecture.md).

Package documentation:

- [Engine SDK](typescript/engine-sdk/README.md)
- [Data SDK](typescript/data-sdk/README.md)

To inspect a distribution archive without publishing:

```sh
mkdir -p /tmp/nuxus-sdk-packages
pnpm --filter @nuxus/engine-sdk pack --out /tmp/nuxus-sdk-packages/engine-sdk.tgz
pnpm --filter @nuxus/data-sdk pack --out /tmp/nuxus-sdk-packages/data-sdk.tgz
pnpm check:packages /tmp/nuxus-sdk-packages --check-types
```

Each archive contains compiled ESM, TypeScript declarations, its README, usage documentation, license,
changelog, and package metadata. Publishing is a separate step.

## Continuous integration

[SDK CI](.github/workflows/ci.yml) runs on pull requests targeting `main`, pushes
to `main`, and manual dispatches. It uses the Node version in `.nvmrc`, pnpm from
`packageManager`, and the checksum-verified CLI version in `.gitleaks-version`.

The validation job scans Git history, installs the frozen lockfile, and runs
format, lint, public type, hook, and SDK runtime checks. Package prepack scripts
build clean output. The resulting archives are checked for compiled exports,
declarations, license/docs, and unexpected files or runtime dependencies.

An isolated npm consumer installs only those two archives offline, with lifecycle
scripts disabled. Mock HTTP/WebSocket tests and declaration checks exercise the
installed packages. A second job repeats runtime checks on Node.js 22 without
installing repository development dependencies. No private core checkout or
service credentials are needed.

Verified archives are available as the `sdk-packages` workflow artifact for seven
days. The separate [SDK Release workflow](.github/workflows/release.yml) runs on
package tags and publishes only the selected SDK using npm Trusted Publishing.

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
