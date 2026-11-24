import { IncomingMessage } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import type WebSocket from "ws";
import { WebSocketServer } from "ws";
import { logger } from "../utils/logger";
import { systemConfig } from "../utils/system-config";
import { DiscordForwarder } from "../discord/discord-forwarder";
import { RelayState } from "./relay-state";
import {
  ChatMessage,
  GIEvent,
  PlayerCloseChannelMessage,
  PlayerCreateChannelMessage,
  PlayerJoinChannelMessage,
  PlayerLeaveChannelMessage,
  PlayerMessage,
  PlayerOverrideChangeMessage,
  PlayerRegisterMessage,
  PlayerUnregisterMessage,
  RelayClient,
  ServerPresenceSubscribeMessage,
  ServerRegisterMessage,
  ServerPresenceMessage,
  ClientRegisterMessage,
  WSMessage,
} from "./types";

export class RelayServer {
  private readonly state = new RelayState(systemConfig.persistencePath, systemConfig.channelSecret);
  private readonly discordForwarder = DiscordForwarder.fromSystemConfig();
  private server: WebSocketServer | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private connectionIndex = 0;
  private saveQueue: Promise<void> = Promise.resolve();

  async start(): Promise<void> {
    await this.state.load();
    await this.discordForwarder.start((chatMessage) => this.handleExternalBroadcast(chatMessage));
    this.server = new WebSocketServer({ host: systemConfig.host, port: systemConfig.port });
    this.server.on("connection", (client: RelayClient, request: IncomingMessage) => this.onConnection(client, request));
    this.server.on("error", (error) => logger.error("Relay server error", error));
    this.saveTimer = setInterval(() => {
      this.queueStateSave("periodic");
    }, systemConfig.saveIntervalMs);
    logger.log(`${systemConfig.appName} listening on ${systemConfig.host}:${systemConfig.port}`);
  }

  async stop(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveQueue;
    await this.state.save(true);
    await this.discordForwarder.stop();
    await new Promise<void>((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      for (const client of this.server.clients) {
        client.terminate();
      }
      this.server.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = null;
  }

  private onConnection(client: RelayClient, request: IncomingMessage): void {
    client.relayId = this.connectionIndex++;
    client.remoteAddress = request.socket.remoteAddress ?? "unknown";
    logger.log(`Client connected ${client.relayId} from ${request.socket.remoteAddress ?? "unknown"}`);
    client.on("message", (raw) => this.onMessage(client, rawDataToString(raw)));
    client.on("close", () => {
      this.state.removeOrigin(client);
      this.broadcastServerPresence();
      logger.log(`Client disconnected ${client.relayId}`);
    });
    client.on("error", (error) => logger.error(`Client error ${client.relayId}`, error));
  }

  private onMessage(client: RelayClient, raw: string): void {
    let message: WSMessage;
    try {
      message = JSON.parse(raw) as WSMessage;
    } catch (error) {
      logger.warn(`Ignoring invalid JSON from ${client.relayId}: ${(error as Error).message}`);
      return;
    }
    if (systemConfig.logLevel === "debug") {
      logger.log(`Received relay event ${message.event} from ${client.relayId}`);
    }

    try {
      switch (message.event) {
        case "erasureProbe":
          this.erasePlayer(client, message.payload, true);
          break;
        case "erasePlayer":
          this.erasePlayer(client, message.payload, false);
          break;
        case GIEvent.BroadcastMessage:
          this.handleBroadcast(client, message.payload as ChatMessage);
          break;
        case GIEvent.RegisterPlayer:
          this.send(client, this.state.registerPlayer(message.payload as PlayerRegisterMessage));
          this.queueStateSave(message.event);
          break;
        case GIEvent.UnregisterPlayer:
          this.send(client, this.state.unregisterPlayer(message.payload as PlayerUnregisterMessage));
          this.queueStateSave(message.event);
          break;
        case GIEvent.PlayerOnline:
          this.state.registerLegacyServer(client);
          this.send(client, this.state.playerOnline(client, message.payload as PlayerMessage));
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        case GIEvent.PlayerOffline: {
          const response = this.state.playerOffline(client, message.payload as PlayerMessage);
          if (response) {
            this.send(client, response);
          }
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        }
        case GIEvent.PlayerJoinChannel:
          this.sendAll(client, this.state.joinChannel(message.payload as PlayerJoinChannelMessage));
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        case GIEvent.PlayerLeaveChannel:
          this.sendAll(client, this.state.leaveChannel(message.payload as PlayerLeaveChannelMessage));
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        case GIEvent.PlayerCreateChannel:
          this.sendAll(client, this.state.createChannel(message.payload as PlayerCreateChannelMessage));
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        case GIEvent.PlayerCloseChannel: {
          const result = this.state.closeChannel(message.payload as PlayerCloseChannelMessage);
          this.sendAll(client, result.responses);
          for (const notification of result.notifications) {
            this.send(notification.client, notification.message);
          }
          this.broadcastServerPresence();
          this.queueStateSave(message.event);
          break;
        }
        case GIEvent.PlayerOverrideChange:
          this.send(client, this.state.overrideChange(message.payload as PlayerOverrideChangeMessage));
          this.queueStateSave(message.event);
          break;
        case GIEvent.ServerRegister:
          this.state.registerServer(client, message.payload as ServerRegisterMessage);
          this.broadcastServerPresence();
          break;
        case GIEvent.ClientRegister:
          this.state.registerClient(client, message.payload as ClientRegisterMessage);
          this.broadcastServerPresence();
          break;
        case GIEvent.ServerPresenceSubscribe: {
          const payload = message.payload as ServerPresenceSubscribeMessage;
          this.sendServerPresence(client, this.state.subscribeServerPresence(client, payload.channel));
          break;
        }
        default:
          logger.warn(`Unknown relay event ${message.event} from ${client.relayId}`);
          break;
      }
    } catch (error) {
      logger.error(`Failed to handle relay event ${message.event} from ${client.relayId}`, error);
    }
  }

  private handleBroadcast(client: RelayClient, chatMessage: ChatMessage): void {
    const error = this.state.broadcastMessage(chatMessage);
    if (error) {
      this.send(client, error);
      return;
    }
    this.broadcast({ event: GIEvent.BroadcastMessage, payload: chatMessage });
    if (systemConfig.logLevel === "debug") 
      logger.debug(chatMessage);
    this.discordForwarder.forward(chatMessage).catch((error) => {
      logger.warn(`Discord forwarding failed: ${(error as Error).message}`);
    });
  }

  private handleExternalBroadcast(chatMessage: ChatMessage): void {
    const error = this.state.externalBroadcastMessage(chatMessage);
    if (error) {
      logger.warn(`Ignoring external relay broadcast for ${error.subject ?? "unknown"}: ${error.errorCode ?? "invalid"}`);
      return;
    }
    this.broadcast({ event: GIEvent.BroadcastMessage, payload: chatMessage });
    if (systemConfig.logLevel === "debug") {
      logger.debug(chatMessage);
    }
    this.discordForwarder.forward(chatMessage).catch((error) => {
      logger.warn(`Discord forwarding failed: ${(error as Error).message}`);
    });
  }

  private sendAll(client: RelayClient, messages: WSMessage[]): void {
    for (const message of messages) {
      this.send(client, message);
    }
  }

  private send(client: RelayClient, message: WSMessage): void {
    if (client.readyState === 1) {
      if (systemConfig.logLevel === "debug") {
        logger.log(`Sending relay event ${message.event} to ${client.relayId}`);
      }
      client.send(JSON.stringify(message));
    }
  }

  private broadcast(message: WSMessage): void {
    for (const client of this.state.relayClients()) {
      this.send(client, message);
    }
  }

  private broadcastServerPresence(): void {
    const channel = "global";
    const message: WSMessage<ServerPresenceMessage> = {
      event: GIEvent.ServerPresence,
      payload: { channel, servers: this.state.serverPresence(channel) },
    };
    for (const client of this.state.serverPresenceSubscribers(channel)) {
      this.send(client, message);
    }
  }

  private sendServerPresence(client: RelayClient, channel: string): void {
    this.send(client, {
      event: GIEvent.ServerPresence,
      payload: { channel, servers: this.state.serverPresence(channel) } satisfies ServerPresenceMessage,
    });
  }

  private queueStateSave(reason: string): void {
    this.saveQueue = this.saveQueue
      .then(() => this.state.save())
      .catch((error) => logger.error(`Relay save failed after ${reason}`, error));
  }

  private erasePlayer(client: RelayClient, payload: unknown, probe: boolean): void {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const { serverId, uid, requestId, issuedAt, signature } = payload as Record<string, unknown>;
    if (typeof serverId !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(serverId)
        || typeof uid !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid)
        || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/.test(requestId)
        || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)
        || typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)
        || Math.abs(Date.now() - issuedAt) > 30_000) return;
    const keys: Record<string, unknown> = JSON.parse(process.env.INTERCOM_ERASURE_KEYS_JSON ?? "{}");
    const key = Object.prototype.hasOwnProperty.call(keys, serverId) ? keys[serverId] : undefined;
    if (typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key)) return;
    const signed = [probe ? "intercom-erasure-probe" : "intercom-player-erasure", serverId, requestId, uid, issuedAt].join("\n");
    const expected = createHmac("sha256", key).update(signed).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return;
    if (probe) {
      this.send(client, { event: "erasureAvailable", payload: { requestId } });
      return;
    }
    this.saveQueue = this.saveQueue.then(async () => {
      if (!this.state.erasePlayer(uid)) return;
      await this.state.save(true);
      this.send(client, { event: "playerErased", payload: { requestId } });
    }).catch(() => logger.error("Relay could not persist a player erasure"));
  }
}

function rawDataToString(raw: WebSocket.RawData): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString("utf8");
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString("utf8");
  }
  return Buffer.from(raw).toString("utf8");
}
