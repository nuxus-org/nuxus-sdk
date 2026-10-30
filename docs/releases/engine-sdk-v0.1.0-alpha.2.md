# @nuxus/engine-sdk 0.1.0-alpha.2

This release validates the initial npm Trusted Publisher connection by publishing
the verified CI archive directly from GitHub Actions using OIDC, with provenance.
The first alpha was published manually to create the package on npm.

## Changes

- Exercise the complete automated publication path for this package.
- Update package documentation for published SDK installation and include the
  finalized alpha.1 release date.

The SDK runtime, public API, and runtime dependencies are unchanged from
`0.1.0-alpha.1`. This version advances the `alpha` distribution tag.

## Installation

```sh
npm install @nuxus/engine-sdk@0.1.0-alpha.2
```

The package ships compiled ESM and TypeScript declarations, supports browsers and
Node.js 22+, and is licensed under MIT. Existing
[alpha.1 compatibility requirements and limitations](https://github.com/nuxus-org/nuxus-sdk/releases/tag/engine-sdk-v0.1.0-alpha.1)
continue to apply.
