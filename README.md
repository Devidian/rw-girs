# Global Intercom Relay Server

`rw-girs` is the Node.js relay backend for the Rising World Global Intercom
plugin. It accepts the existing Java plugin WebSocket contract and coordinates
player state, channel membership, channel ownership, and chat broadcast between
connected game servers.

## Runtime

- Node.js 24+
- Yarn 4 as configured by `.yarnrc.yml`
- WebSocket endpoint: `ws://HOST:PORT/ws` or `wss://HOST:PORT/ws` behind TLS

## Configuration

Environment variables:

- `GIRS_HOST`: bind host, default `0.0.0.0`
- `GIRS_PORT`: WebSocket port, default `47015`
- `GIRS_PERSISTENCE_PATH`: JSON state file, default `data/relay-state.json`
- `GIRS_SAVE_INTERVAL_MS`: periodic save interval, default `30000`
- `GIRS_LOG_LEVEL`: currently informational only, default `info`
- `GIRS_APP_NAME`: service name used in startup logging
- `GIRS_CHANNEL_SECRET`: HMAC secret for password-protected channels, default
  matches the legacy relay fallback

Legacy aliases are accepted where useful: `APP_WSS_PORT`, `PORT`, `SALT`, and
`APP_LOGLEVEL`, `APP_TITLE`.

## Behavior

- Default channels are created on startup: `global`, `global-dev`, `global-de`,
  `global-en`, `global-ru`, and `global-fr`.
- Player save state, saved channel memberships, and channels are persisted to
  JSON with atomic file replacement.
- Chat messages are relayed only in memory and are never written to the
  persistence file.
- Restart recovery restores saved players and channels, marks players offline,
  and waits for plugin clients to reconnect and send `playerOnline`.
- The relay preserves the current Java plugin event names and payload fields.

## Commands

```sh
yarn build
yarn test
yarn start
```

`yarn test` builds the TypeScript project and runs a local contract smoke test
with two simulated Global Intercom clients, channel joins, broadcast relay,
custom channel persistence, restart recovery, and a check that chat text is not
persisted.

## Docker

The published DockerHub image is:

```sh
${DOCKER_USERNAME}/rw-girs
```

Pull and run the current `main` build:

```sh
docker pull ${DOCKER_USERNAME}/rw-girs:latest
docker run --rm -p 47015:47015 \
  -v rw-girs-data:/app/data \
  ${DOCKER_USERNAME}/rw-girs:latest
```

Versioned releases are also available after Git tags are published. For
`v0.1.0`, the workflow publishes both:

```sh
${DOCKER_USERNAME}/rw-girs:v0.1.0
${DOCKER_USERNAME}/rw-girs:0.1.0
```

The container exposes port `47015` and starts the relay with
`node dist/main.js`. Runtime configuration is still controlled through the
environment variables listed above.

## CI and Release

GitHub Actions validates pull requests with dependency installation, TypeScript
build, contract smoke test, and a Docker image build without DockerHub push.

Pushes to `main` publish only `${DOCKER_USERNAME}/rw-girs:latest`. Git tags that
match `v*` publish versioned DockerHub tags only, for example `v0.1.0` and
`0.1.0`; tag builds do not update `latest`. The tag workflow also creates a
GitHub Release with generated release notes and the DockerHub image tags.
