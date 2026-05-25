# Roadmap Plan 02 Relay Server

## Objective
Build a lightweight Node.js 24+ Global Intercom Relay Server for WebSocket-based cross-server chat and channel coordination, using in-memory state with periodic JSON persistence instead of MongoDB.

## Ownership
Primary repository: `rw-girs`.

Supporting repositories:
- `rw-plugin-oz-global-intercom` owns the Rising World Java plugin client and protocol expectations.

## Dependencies
- Node.js 24+ runtime.
- Existing Java relay at `/mnt/r/Privat/Spiele/RisingWorld/Plugins/GlobalIntercomRelay/` is reference material only.

## Work Packages
- [x] Package 1: Inspect the existing `rw-girs` project and legacy Java relay reference to document the required protocol.
- [x] Package 2: Define WebSocket message contracts for server registration, player state, channel creation, channel join/leave, channel close, and chat relay.
- [x] Package 3: Implement in-memory state for connected servers, players, channels, and persistent channel preferences.
- [x] Package 4: Add periodic JSON persistence for player/channel data, explicitly excluding chat-message history.
- [x] Package 5: Add restart recovery that restores persisted player/channel data and tolerates missing disconnected servers.
- [x] Package 6: Add configuration for host, port, persistence path, save interval, and logging level.
- [x] Package 7: Add validation scripts or tests for multi-server relay scenarios.
- [x] Package 8: Document deployment, update, and compatibility requirements for Global Intercom.

## Step 7 Notes
- Implemented a lightweight `ws` relay server owned by `rw-girs`; it does not depend on MongoDB or Discord for the first JSON-backed implementation.
- The relay follows the Java plugin contract documented in `rw-plugin-oz-global-intercom/docs/relay-contract.md`; event names and payload field names are preserved.
- Persistent state is limited to saved players and channels. Chat messages are never written to the JSON persistence file.
- Restart recovery reloads saved players/channels, marks players offline, and relies on reconnecting plugin clients to refresh live origins through `playerOnline`.
- `yarn test` now builds the project and runs a local two-client contract smoke test covering joins, broadcast relay, custom channel persistence, restart recovery, and no chat persistence.
- Runtime validation on a real Rising World server remains recommended before production deployment.

## Risks
- The legacy Java relay may contain implicit behavior not documented in current plugin docs.
- JSON persistence needs atomic write behavior to avoid corrupting state on process exit.
- The relay must not persist chat messages.

## Validation Strategy
- Run Yarn build/test or equivalent project validation.
- Simulate at least two server clients, multiple channels, join/leave/close flows, and restart recovery.
- Verify no chat-message content is written to persistence files.

## Affected Repositories/Plugins
- `rw-girs`
- `rw-plugin-oz-global-intercom`

## Rollback Considerations
Keep Global Intercom compatible with the existing relay until the new relay has a validated protocol and deployment path.
