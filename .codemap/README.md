# Global Intercom relay
<!-- codemap-id: rw-girs -->

## Purpose

TypeScript WebSocket relay for inter-server chat and optional Discord forwarding. [Main](../src/main.ts) starts [RelayServer](../src/relay/relay-server.ts); [configuration](../src/utils/system-config.ts) controls integrations.

## Modules

- [Relay protocol and state](modules/relay.md)
- [Discord forwarding](modules/discord.md)

## Build and tests

[Package scripts](../package.json) define `yarn build` and `yarn test`, including [contract smoke](../src/contract-smoke.ts).
