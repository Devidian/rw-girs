import { Client, GatewayIntentBits } from "discord.js";
import { logger } from "../utils/logger";
import { systemConfig } from "../utils/system-config";
import { ChatMessage } from "../relay/types";

export interface DiscordForwarderConfig {
  enabled: boolean;
  botToken?: string;
  channelIdsByRelayChannel: Map<string, string>;
  failureBackoffMs: number;
}

export interface DiscordMessageSender {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(channelId: string, content: string): Promise<void>;
}

export class DiscordForwarder {
  private readonly failedUntilByChannelId = new Map<string, number>();

  constructor(
    private readonly config: DiscordForwarderConfig,
    private readonly sender: DiscordMessageSender,
  ) {}

  static fromSystemConfig(): DiscordForwarder {
    return new DiscordForwarder(systemConfig.discord, new DiscordJsMessageSender(systemConfig.discord.botToken));
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      return;
    }
    if (!this.config.botToken || this.config.channelIdsByRelayChannel.size < 1) {
      logger.warn("Discord forwarding is enabled but token or channel mapping is missing; forwarding disabled.");
      return;
    }
    await this.sender.start();
    logger.log("Discord relay forwarding enabled.");
  }

  async stop(): Promise<void> {
    await this.sender.stop();
  }

  async forward(chatMessage: ChatMessage): Promise<void> {
    if (!this.config.enabled || isDiscordOrigin(chatMessage)) {
      return;
    }
    const relayChannel = normalizeChannel(chatMessage.chatChannel);
    const discordChannelId = this.config.channelIdsByRelayChannel.get(relayChannel);
    if (!discordChannelId) {
      return;
    }
    const failedUntil = this.failedUntilByChannelId.get(discordChannelId) ?? 0;
    if (failedUntil > Date.now()) {
      return;
    }
    try {
      await this.sender.send(discordChannelId, formatDiscordMessage(chatMessage));
    } catch (error) {
      this.failedUntilByChannelId.set(discordChannelId, Date.now() + this.config.failureBackoffMs);
      logger.warn(`Discord forwarding failed for channel ${discordChannelId}: ${(error as Error).message}`);
    }
  }
}

class DiscordJsMessageSender implements DiscordMessageSender {
  private client: Client | null = null;

  constructor(private readonly token: string | undefined) {}

  async start(): Promise<void> {
    if (!this.token) {
      return;
    }
    this.client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await this.client.login(this.token);
  }

  async stop(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
  }

  async send(channelId: string, content: string): Promise<void> {
    if (!this.client) {
      throw new Error("Discord client is not started.");
    }
    const channel = await this.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !canSendText(channel)) {
      throw new Error(`Discord channel ${channelId} is missing or not sendable text.`);
    }
    await channel.send(content);
  }
}

interface SendableTextChannel {
  send(content: string): Promise<unknown>;
}

function formatDiscordMessage(chatMessage: ChatMessage): string {
  const channel = normalizeChannel(chatMessage.chatChannel);
  const player = chatMessage.playerName?.trim() || "Unknown";
  const source = chatMessage.sourceName?.trim() || "Rising World";
  const content = chatMessage.chatContent?.trim() || "";
  return `[${channel}] ${player} @ ${source}: ${content}`;
}

function normalizeChannel(channel: string): string {
  return (channel ?? "").trim().toLowerCase();
}

function isDiscordOrigin(chatMessage: ChatMessage): boolean {
  return normalizeChannel(chatMessage.sourceName) === "discord"
    || normalizeChannel(chatMessage.sourceIP) === "discord";
}

function canSendText(channel: unknown): channel is SendableTextChannel {
  return typeof (channel as SendableTextChannel | undefined)?.send === "function";
}
