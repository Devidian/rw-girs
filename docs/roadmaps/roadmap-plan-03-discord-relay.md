# Roadmap Plan 03 Discord Relay

## Objective
Add an optional Discord component to the GIRS relay service so global relay messages can be bridged with configured Discord channel ids.

## Ownership
Primary repository/service: `rw-girs`

Supporting repository:
- `rw-plugin-oz-global-intercom` for contract compatibility verification only.

## Dependencies
- Existing WebSocket relay contract must remain backward-compatible.
- Discord integration must be optional and disabled unless configured.
- Destination configuration must use Discord channel ids, not channel names.

## Phases
- [x] Phase 1: Review the original project's optional Discord behavior and map it to the current TypeScript relay architecture.
- [x] Phase 2: Define config keys for bot/token/client setup and per-target Discord channel ids without requiring Discord when disabled.
- [x] Phase 3: Add relay-to-Discord forwarding for eligible global messages while avoiding loops and preserving existing relay behavior.
- [x] Phase 4: Add error handling for missing channels, permission failures, and rate-limit/backoff behavior.
- [x] Phase 5: Document deployment/configuration and validate with tests or a mocked Discord adapter.

## Risks
- Discord dependencies can increase deployment requirements for users who do not enable the feature.
- Forwarding by names would be unstable; channel ids must be the persisted target identifiers.
- Message forwarding must avoid loops when Discord-originated messages enter the relay.

## Validation Strategy
- Run `yarn test`.
- Run the TypeScript build script configured by the repository.
- Add targeted tests for disabled Discord config, channel-id routing, invalid channel handling, and unchanged relay smoke behavior.

## Affected Repositories/Services
- `rw-girs`
- Compatibility verification with `rw-plugin-oz-global-intercom`

## Rollback Considerations
Keep Discord support behind configuration. Removing or disabling the Discord adapter should leave the WebSocket relay behavior unchanged.

## Progress Notes
- Phase 1 complete: Discord forwarding is implemented as a TypeScript adapter owned by `rw-girs`; the WebSocket relay contract and persistence shape are unchanged.
- Phase 2 complete: `GIRS_DISCORD_ENABLED`, `GIRS_DISCORD_BOT_TOKEN`, `GIRS_DISCORD_CHANNELS`, and `GIRS_DISCORD_FAILURE_BACKOFF_MS` configure optional forwarding by Discord channel id.
- Phase 3 complete: validated relay `broadcastMessage` payloads are forwarded only when their relay channel has a configured Discord channel id. Discord-origin markers are ignored to avoid loops.
- Phase 4 complete: missing/non-text Discord channels and send failures are logged and backed off per channel.
- Phase 5 complete: README is updated and the contract smoke test includes a mocked Discord adapter.
- Validation passed with `yarn build` and `yarn test`.
- Follow-up complete: Discord user messages in mapped Discord channels are now converted to external relay broadcasts for the matching GIRS channel, using Discord source metadata so they are not echoed back to Discord.
