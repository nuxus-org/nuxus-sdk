# SDK architecture

Each package builds independently and has no runtime dependencies or imports
from private Nuxus applications. The entry point exports clients, error classes,
and public contract types; transport helpers remain internal.

## Engine SDK

| Module                                      | Responsibility                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `client.ts`                                 | Public facade and ownership of a shared connection                       |
| `connection.ts`                             | Handshake, status snapshots, backoff, heartbeat, teardown                |
| `request-manager.ts`                        | IDs, pending capacity, deadlines, batches, response envelopes            |
| `subscription-manager.ts`                   | Local/remote registration, restoration, cancellation, sequence filtering |
| `solana.ts`                                 | Typed method bindings and the Solana namespace contract                  |
| `http-client.ts`                            | Query-only HTTP allowlist and bounded cancellation                       |
| `options.ts`, `protocol.ts`, `constants.ts` | Configuration validation and transport primitives                        |
| `types/`                                    | Client, transaction, swap, and token-creation contracts                  |

The connection routes validated envelopes to request/subscription managers.
A generation identifies a connection attempt; completions from an old generation
cannot affect its replacement. Request handlers are registered before sending,
and subscription IDs are bound while handling the acknowledgement, before a
notification in the same frame can arrive.

Sent requests are never replayed. Only active subscriptions restore after a
reconnect. Cancelling a setup releases a late remote ID; one-shot signature
notifications release local state without an extra unsubscribe.

## Data SDK

| Module                                                | Responsibility                                         |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `client.ts`, `http-client.ts`                         | Public WebSocket and HTTP APIs                         |
| `connection.ts`, `options.ts`                         | Authenticated socket lifecycle and configuration       |
| `authentication.ts`                                   | Token supplier validation and cancellable async work   |
| `request-queue.ts`                                    | Rolling send budget, queue limits, deadlines, batching |
| `subscription-manager.ts`                             | Shared subscription registration and recovery          |
| `<provider>.subscriptions.ts`                         | Binance, Solana, and Pump.fun subscription definitions |
| `<provider>.protocol.ts`                              | Provider-specific parameter and response validation    |
| `queries.ts`, `protocol.ts`                           | Query routing and shared JSON-RPC validation           |
| `contracts.ts`, `<provider>.contracts.ts`, `types.ts` | Public DTOs and client types                           |

Authentication happens before the socket is considered ready. Tokens are never
placed in URLs, persisted, or logged. Closing the client ends the current
session's pending work and registrations.

## Changing the SDKs

Preserve exact price/base-unit strings, transport permissions, and session
boundaries. Keep comments for timing, security, and precision constraints rather
than repeating method names. Update public type checks and runtime regression
tests when behavior changes. Tests use local mock sockets/fetch; backend
conformance checks live in `nuxus-core/packages/sdk-contracts`.

Run build, type, lint, test, and formatting checks from the root. `build` removes
old output before compilation. Inspect packed archives and verify them in an
isolated consumer before publishing. `publishConfig` strips the source-only
`development` export, includes the MIT license and usage docs, and selects the
`alpha` tag. Packing does not publish anything.
