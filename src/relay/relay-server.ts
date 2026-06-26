import { IncomingMessage } from "node:http";
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
  WSMessage,
} from "./types";

export class RelayServer {
  private readonly state = new RelayState(systemConfig.persistencePath, systemConfig.channelSecret);
  private readonly discordForwarder = DiscordForwarder.fromSystemConfig();
  private server: WebSocketServer | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private connectionIndex = 0;

  async start(): Promise<void> {
    await this.state.load();
    await this.discordForwarder.start((chatMessage) => this.handleExternalBroadcast(chatMessage));
    this.server = new WebSocketServer({ host: systemConfig.host, port: systemConfig.port });
    this.server.on("connection", (client: RelayClient, request: IncomingMessage) => this.onConnection(client, request));
    this.server.on("error", (error) => logger.error("Relay server error", error));
    this.saveTimer = setInterval(() => {
      this.state.save().catch((error) => logger.error("Periodic relay save failed", error));
    }, systemConfig.saveIntervalMs);
    logger.log(`${systemConfig.appName} listening on ${systemConfig.host}:${systemConfig.port}`);
  }

  async stop(): Promise<void> {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
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
    logger.log(`Client connected ${client.relayId} from ${request.socket.remoteAddress ?? "unknown"}`);
    client.on("message", (raw) => this.onMessage(client, rawDataToString(raw)));
    client.on("close", () => {
      this.state.removeOrigin(client);
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
        case GIEvent.BroadcastMessage:
          this.handleBroadcast(client, message.payload as ChatMessage);
          break;
        case GIEvent.RegisterPlayer:
          this.send(client, this.state.registerPlayer(message.payload as PlayerRegisterMessage));
          break;
        case GIEvent.UnregisterPlayer:
          this.send(client, this.state.unregisterPlayer(message.payload as PlayerUnregisterMessage));
          break;
        case GIEvent.PlayerOnline:
          this.send(client, this.state.playerOnline(client, message.payload as PlayerMessage));
          break;
        case GIEvent.PlayerOffline: {
          const response = this.state.playerOffline(client, message.payload as PlayerMessage);
          if (response) {
            this.send(client, response);
          }
          break;
        }
        case GIEvent.PlayerJoinChannel:
          this.sendAll(client, this.state.joinChannel(message.payload as PlayerJoinChannelMessage));
          break;
        case GIEvent.PlayerLeaveChannel:
          this.sendAll(client, this.state.leaveChannel(message.payload as PlayerLeaveChannelMessage));
          break;
        case GIEvent.PlayerCreateChannel:
          this.sendAll(client, this.state.createChannel(message.payload as PlayerCreateChannelMessage));
          break;
        case GIEvent.PlayerCloseChannel: {
          const result = this.state.closeChannel(message.payload as PlayerCloseChannelMessage);
          this.sendAll(client, result.responses);
          for (const notification of result.notifications) {
            this.send(notification.client, notification.message);
          }
          break;
        }
        case GIEvent.PlayerOverrideChange:
          this.send(client, this.state.overrideChange(message.payload as PlayerOverrideChangeMessage));
          break;
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
