# Relay protocol and state
<!-- codemap-id: rw-girs/relay -->

## Responsibility

WebSocket server, registration, presence, channels, chat routing and relay state. Messages cross the plugin boundary and must be checked on both sides.

## Source and tests

- [`RelayServer`](../../src/relay/relay-server.ts) handles socket messages; [`RelayState`](../../src/relay/relay-state.ts) handles channel and player state.
- [`WSMessage`](../../src/relay/types.ts) and related types define relay-side messages. [Configuration](../../src/utils/system-config.ts) configures the relay.
- [Contract smoke](../../src/contract-smoke.ts) exercises protocol and forwarding. See [Discord](discord.md).
- [Relay state tests](../../tests/relay-state.test.cjs) cover graceful and abrupt origin cleanup and saved-player recovery.

## Dependencies

- `rw-plugin-oz-global-intercom/relay` — WebSocket protocol peer. [Message types](../../src/relay/types.ts)
