import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { GIEvent, WSMessage } from "./relay/types";
import type { DiscordInboundMessage, DiscordMessageSender } from "./discord/discord-forwarder";

class TestClient {
  private readonly queue: WSMessage[] = [];
  private readonly waiters: Array<(message: WSMessage) => void> = [];

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as WSMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.queue.push(message);
      }
    });
  }

  send(event: GIEvent, payload: unknown): void {
    this.socket.send(JSON.stringify({ event, payload }));
  }

  close(): void {
    this.socket.close();
  }

  next(): Promise<WSMessage> {
    const queued = this.queue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const waiter = (message: WSMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      const timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(new Error("timed out waiting for WebSocket message"));
      }, 3000);
      this.waiters.push(waiter);
    });
  }
}

async function main(): Promise<void> {
  const dataDir = await mkdtemp(join(tmpdir(), "rw-girs-"));
  process.env.GIRS_HOST = "127.0.0.1";
  process.env.GIRS_PORT = "48115";
  process.env.GIRS_PERSISTENCE_PATH = join(dataDir, "relay-state.json");
  process.env.GIRS_SAVE_INTERVAL_MS = "100000";
  process.env.GIRS_LOG_LEVEL = "debug";

  const { RelayServer } = await import("./relay/relay-server");
  const server = new RelayServer();
  await server.start();

  const clientA = await connect();
  const clientB = await connect();

  clientA.send(GIEvent.PlayerOnline, player("100", "Alice"));
  assert((await clientA.next()).event === GIEvent.PlayerOnline, "Alice online response missing");
  clientB.send(GIEvent.PlayerOnline, player("200", "Bob"));
  assert((await clientB.next()).event === GIEvent.PlayerOnline, "Bob online response missing");

  clientA.send(GIEvent.PlayerJoinChannel, { ...player("100", "Alice"), channel: "global" });
  await expectEvent(clientA, GIEvent.PlayerJoinChannel);
  await expectSuccess(clientA, "RELAY_JOIN_SUCCESS");
  clientB.send(GIEvent.PlayerJoinChannel, { ...player("200", "Bob"), channel: "global" });
  await expectEvent(clientB, GIEvent.PlayerJoinChannel);
  await expectSuccess(clientB, "RELAY_JOIN_SUCCESS");

  clientA.send(GIEvent.BroadcastMessage, {
    createdOn: new Date().toISOString(),
    chatVersion: 2,
    chatContent: "hello from smoke",
    chatChannel: "global",
    playerName: "Alice",
    playerUID: "100",
    sourceName: "SmokeA",
    sourceIP: "127.0.0.1",
    sourceVersion: "test",
  });
  await expectEvent(clientA, GIEvent.BroadcastMessage);
  await expectEvent(clientB, GIEvent.BroadcastMessage);

  clientA.send(GIEvent.RegisterPlayer, { ...player("100", "Alice"), register: true });
  await expectSuccess(clientA, "RELAY_SUCCESS_REGISTER");
  clientA.send(GIEvent.PlayerCreateChannel, { ...player("100", "Alice"), channel: "smoke" });
  await expectEvent(clientA, GIEvent.PlayerCreateChannel);
  await expectSuccess(clientA, "RELAY_CREATE_SUCCESS");

  await verifySamePlayerMultipleOrigins();

  clientA.close();
  clientB.close();
  await server.stop();

  const persisted = await readFile(process.env.GIRS_PERSISTENCE_PATH, "utf8");
  assert(persisted.includes("\"smoke\""), "created channel was not persisted");
  assert(!persisted.includes("hello from smoke"), "chat content must not be persisted");

  const restarted = new RelayServer();
  await restarted.start();
  const clientC = await connect();
  clientC.send(GIEvent.PlayerOnline, player("100", "Alice"));
  const online = await clientC.next();
  assert(JSON.stringify(online.payload).includes("smoke"), "persisted player channel was not restored");
  clientC.close();
  await restarted.stop();

  await verifyDiscordForwardingAdapter();
}

function connect(): Promise<TestClient> {
  const socket = new WebSocket("ws://127.0.0.1:48115/ws");
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve(new TestClient(socket)));
    socket.once("error", reject);
  });
}

async function expectEvent(client: TestClient, event: GIEvent): Promise<WSMessage> {
  const message = await client.next();
  assert(message.event === event, `expected ${event}, got ${message.event}`);
  return message;
}

async function expectSuccess(client: TestClient, successCode: string): Promise<WSMessage> {
  const message = await client.next();
  assert(message.event === GIEvent.PlayerResponseSuccess, `expected success response, got ${message.event}`);
  assert(message.successCode === successCode, `expected ${successCode}, got ${message.successCode ?? ""}`);
  return message;
}

async function verifySamePlayerMultipleOrigins(): Promise<void> {
  const clientGame = await connect();
  const clientWeb = await connect();

  clientGame.send(GIEvent.PlayerOnline, player("300", "Carol"));
  await expectEvent(clientGame, GIEvent.PlayerOnline);
  clientWeb.send(GIEvent.PlayerOnline, player("300", "Carol"));
  await expectEvent(clientWeb, GIEvent.PlayerOnline);

  clientGame.send(GIEvent.PlayerJoinChannel, { ...player("300", "Carol"), channel: "global" });
  await expectEvent(clientGame, GIEvent.PlayerJoinChannel);
  await expectSuccess(clientGame, "RELAY_JOIN_SUCCESS");

  clientGame.send(GIEvent.BroadcastMessage, {
    createdOn: new Date().toISOString(),
    chatVersion: 2,
    chatContent: "same player cross source",
    chatChannel: "global",
    playerName: "Carol",
    playerUID: "300",
    sourceName: "Game",
    sourceIP: "127.0.0.1",
    sourceVersion: "test",
    attachment: "abc",
  });
  const gameMessage = await expectEvent(clientGame, GIEvent.BroadcastMessage);
  const webMessage = await expectEvent(clientWeb, GIEvent.BroadcastMessage);
  assert(JSON.stringify(gameMessage.payload).includes("\"attachment\":\"abc\""), "game origin lost attachment");
  assert(JSON.stringify(webMessage.payload).includes("same player cross source"), "web origin missed own game message");

  clientGame.send(GIEvent.PlayerOffline, player("300", "Carol"));
  await expectEvent(clientGame, GIEvent.PlayerOffline);
  clientWeb.send(GIEvent.BroadcastMessage, {
    createdOn: new Date().toISOString(),
    chatVersion: 2,
    chatContent: "web still connected",
    chatChannel: "global",
    playerName: "Carol",
    playerUID: "300",
    sourceName: "Web",
    sourceIP: "web",
    sourceVersion: "test",
  });
  await expectEvent(clientWeb, GIEvent.BroadcastMessage);

  clientGame.close();
  clientWeb.close();
}

function player(playerUID: string, playerName: string): { playerUID: string; playerName: string } {
  return { playerUID, playerName };
}

async function verifyDiscordForwardingAdapter(): Promise<void> {
  const { DiscordForwarder } = await import("./discord/discord-forwarder");
  const sender = new MockDiscordSender();
  const forwarder = new DiscordForwarder(
    {
      enabled: true,
      botToken: "mock-token",
      channelIdsByRelayChannel: new Map([["global", "1234567890"]]),
      failureBackoffMs: 100,
    },
    sender,
  );
  await forwarder.start();
  await forwarder.forward({
    createdOn: new Date().toISOString(),
    chatVersion: 2,
    chatContent: "<color=red><b>forward me</b></color>",
    chatChannel: "global",
    playerName: "<color=#00ff00>Alice</color>",
    playerUID: "100",
    sourceName: "<color=#ff0000>SmokeA</color>",
    sourceIP: "127.0.0.1",
    sourceVersion: "test",
  });
  await forwarder.forward({
    createdOn: new Date().toISOString(),
    chatVersion: 2,
    chatContent: "ignore me",
    chatChannel: "local",
    playerName: "Alice",
    playerUID: "100",
    sourceName: "SmokeA",
    sourceIP: "127.0.0.1",
    sourceVersion: "test",
  });
  assert(sender.started, "Discord mock sender was not started");
  assert(sender.messages.length === 1, "Discord forwarding should only send configured channels");
  assert(sender.messages[0]?.channelId === "1234567890", "Discord forwarding used the wrong channel id");
  assert(sender.messages[0]?.content.includes("forward me") ?? false, "Discord forwarding did not include content");
  assert(
    sender.messages[0]?.content === "[global] Alice @ SmokeA:\n<color=red><b>forward me</b></color>",
    "Discord forwarding format is wrong",
  );
  await forwarder.stop();

  const inboundSender = new MockDiscordSender();
  const inboundMessages: string[] = [];
  const inboundForwarder = new DiscordForwarder(
    {
      enabled: true,
      botToken: "mock-token",
      channelIdsByRelayChannel: new Map([["global", "1234567890"]]),
      failureBackoffMs: 100,
    },
    inboundSender,
  );
  await inboundForwarder.start((message) => inboundMessages.push(message.chatContent));
  inboundSender.receive({
    channelId: "1234567890",
    authorId: "42",
    authorName: "Discord Alice",
    content: "hello from discord",
    createdAt: new Date(),
  });
  inboundSender.receive({
    channelId: "9999999999",
    authorId: "42",
    authorName: "Discord Alice",
    content: "wrong channel",
    createdAt: new Date(),
  });
  assert(inboundMessages.length === 1, "Discord inbound forwarding should only receive configured channels");
  assert(inboundMessages[0] === "hello from discord", "Discord inbound forwarding lost content");
  await inboundForwarder.stop();
}

class MockDiscordSender implements DiscordMessageSender {
  started = false;
  stopped = false;
  readonly messages: Array<{ channelId: string; content: string }> = [];
  private onMessage: ((message: DiscordInboundMessage) => void) | undefined;

  async start(onMessage?: (message: DiscordInboundMessage) => void): Promise<void> {
    this.started = true;
    this.onMessage = onMessage;
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  async send(channelId: string, content: string): Promise<void> {
    this.messages.push({ channelId, content });
  }

  receive(message: DiscordInboundMessage): void {
    this.onMessage?.(message);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
