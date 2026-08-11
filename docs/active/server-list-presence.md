# Channel Server Presence

## Objective

Expose a backward-compatible relay event containing each registered server's
display name and the number of its online players in the requested channel.

## Ownership and compatibility

- GIRS owns the WebSocket contract and derives counts from its live player
  origins; no state is persisted.
- `serverRegister` is additive. Blank names fall back to the remote IP.
- `serverPresence` is emitted on registration, disconnect, online/offline, and
  channel membership changes. Unaware clients ignore it.

## Risks and rollback

Counts are per connected relay server and channel, and exclude web clients.
Removing the additive event restores prior protocol behavior without migration.

## Validation

- [ ] Add typed registration and presence payloads.
- [ ] Cover initial, membership, and disconnect updates in the contract smoke.
- [ ] Build, test, and publish an RC Docker image.
