# Discord forwarding
<!-- codemap-id: rw-girs/discord -->

## Responsibility

Optionally forward configured relay channels to Discord and deliver inbound Discord messages to relay broadcasts.

## Source and tests

- [`DiscordForwarder`](../../src/discord/discord-forwarder.ts) integrates discord.js. [`RelayServer`](../../src/relay/relay-server.ts) sends and receives messages.
- [Configuration](../../src/utils/system-config.ts) selects Discord channels. [Contract smoke](../../src/contract-smoke.ts) exercises forwarding with a mock sender.
