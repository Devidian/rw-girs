const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const buildDir = process.env.RELAY_TEST_BUILD_DIR || path.join(__dirname, "..", "dist");
const { RelayState } = require(path.join(buildDir, "relay", "relay-state.js"));

function player(id) {
  return { playerUID: id, playerName: id };
}

async function withState(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "girs-state-test-"));
  const statePath = path.join(directory, "state.json");
  const state = new RelayState(statePath, "test-secret");
  await state.load();
  try {
    await callback(state, statePath);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

test("abrupt and graceful final departure remove transient channel-less players", async () => {
  await withState(async (state) => {
    const graceful = {};
    const abrupt = {};
    state.playerOnline(graceful, player("graceful"));
    state.playerOnline(abrupt, player("abrupt"));
    assert.equal(state.playerOffline(graceful, player("graceful")).payload.online, false);
    state.removeOrigin(abrupt);
    assert.equal(state.playerOffline(graceful, player("graceful")), null);
    assert.equal(state.playerOffline(abrupt, player("abrupt")), null);
  });
});

test("other origins keep a player online and only final departure clears it", async () => {
  await withState(async (state) => {
    const first = {};
    const second = {};
    state.registerServer(first, { shortName: "First" });
    state.registerServer(second, { shortName: "Second" });
    const shared = state.playerOnline(first, player("shared")).payload;
    state.playerOnline(second, player("shared"));
    state.joinChannel({ ...player("shared"), channel: "global" });
    state.removeOrigin(first);
    assert.equal(shared.online, true);
    assert.deepEqual(state.serverPresence("global"), [{ name: "Second", playerCount: 1, players: ["shared"] }]);
    state.removeOrigin(second);
    assert.equal(shared.online, false);
    const offline = state.playerOffline(second, player("shared"));
    assert.equal(offline.payload.online, false);
    assert.deepEqual(offline.payload.channels, ["global"]);
    assert.deepEqual(state.serverPresence("global"), []);
  });
});

test("saved player survives abrupt close and reloads offline with memberships", async () => {
  await withState(async (state, statePath) => {
    const client = {};
    const saved = state.playerOnline(client, player("saved")).payload;
    state.registerPlayer({ ...player("saved"), register: true });
    state.joinChannel({ ...player("saved"), channel: "global" });
    state.removeOrigin(client);
    assert.equal(saved.online, false);
    const offline = state.playerOffline(client, player("saved"));
    assert.equal(offline.payload.online, false);
    await state.save(true);
    const reloaded = new RelayState(statePath, "test-secret");
    await reloaded.load();
    const restored = reloaded.playerOffline({}, player("saved")).payload;
    assert.equal(restored.saveSettings, true);
    assert.equal(restored.online, false);
    assert.deepEqual(restored.channels, ["global"]);
  });
});

test("closing an unrelated origin does not alter live player state", async () => {
  await withState(async (state) => {
    const owner = {};
    const other = {};
    state.registerServer(owner, { shortName: "Server" });
    state.playerOnline(owner, player("live"));
    state.joinChannel({ ...player("live"), channel: "global" });
    state.removeOrigin(other);
    assert.equal(state.serverPresence("global")[0].playerCount, 1);
    assert.equal(state.playerOffline(owner, player("live")).payload.online, false);
  });
});
