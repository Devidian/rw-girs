import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  ChatMessage,
  GIEvent,
  GlobalIntercomChannel,
  GlobalIntercomPlayer,
  PersistedRelayState,
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

const DEFAULT_CHANNELS = ["global", "global-dev", "global-de", "global-en", "global-ru", "global-fr"];

export class RelayState {
  private readonly players = new Map<string, GlobalIntercomPlayer>();
  private readonly channels = new Map<string, GlobalIntercomChannel>();
  private readonly playerOrigins = new Map<string, Set<RelayClient>>();
  private dirty = false;

  constructor(
    private readonly persistencePath: string,
    private readonly channelSecret: string,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.persistencePath, "utf8");
      const state = JSON.parse(raw) as PersistedRelayState;
      for (const channel of state.channels ?? []) {
        this.channels.set(channel._id, {
          _id: channel._id,
          description: channel.description ?? "",
          secure: Boolean(channel.secure),
          password: channel.password ?? null,
          ownerId: channel.ownerId ?? null,
        });
      }
      for (const player of state.players ?? []) {
        this.players.set(player._id, { ...player, online: false, channels: [...(player.channels ?? [])] });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }

    this.ensureDefaultChannels();
  }

  async save(force = false): Promise<void> {
    if (!force && !this.dirty) {
      return;
    }

    const state: PersistedRelayState = {
      version: 1,
      savedAt: new Date().toISOString(),
      players: [...this.players.values()]
        .filter((player) => player.saveSettings)
        .map((player) => ({ ...player, online: false, channels: [...player.channels] })),
      channels: [...this.channels.values()].map((channel) => ({ ...channel })),
    };

    await mkdir(dirname(this.persistencePath), { recursive: true });
    const tmpPath = `${this.persistencePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmpPath, this.persistencePath);
    this.dirty = false;
  }

  removeOrigin(client: RelayClient): void {
    for (const [playerId, origins] of this.playerOrigins.entries()) {
      origins.delete(client);
      if (origins.size === 0) {
        this.playerOrigins.delete(playerId);
      }
    }
  }

  playerOnline(client: RelayClient, data: PlayerMessage): WSMessage<GlobalIntercomPlayer> {
    const player = this.getPlayer(data);
    player.online = true;
    this.addOrigin(player._id, client);
    this.markPersistentPlayerDirty(player);
    return { event: GIEvent.PlayerOnline, payload: player };
  }

  playerOffline(client: RelayClient, data: PlayerMessage): WSMessage<GlobalIntercomPlayer> | null {
    const player = this.players.get(data.playerUID);
    if (!player) {
      return null;
    }

    const origins = this.playerOrigins.get(player._id);
    origins?.delete(client);
    if (origins && origins.size === 0) {
      this.playerOrigins.delete(player._id);
    }
    player.online = Boolean(origins && origins.size > 0);
    if (!player.online && !player.saveSettings && player.channels.length < 1) {
      this.players.delete(player._id);
    } else {
      this.markPersistentPlayerDirty(player);
    }
    return { event: GIEvent.PlayerOffline, payload: player };
  }

  registerPlayer(data: PlayerRegisterMessage): WSMessage<GlobalIntercomPlayer> {
    const player = this.getPlayer(data);
    if (player.saveSettings) {
      return { event: GIEvent.PlayerResponseInfo, payload: player, infoCode: "RELAY_INFO_REGISTERED" };
    }
    player.saveSettings = true;
    this.dirty = true;
    return { event: GIEvent.PlayerResponseSuccess, payload: player, successCode: "RELAY_SUCCESS_REGISTER" };
  }

  unregisterPlayer(data: PlayerUnregisterMessage): WSMessage<GlobalIntercomPlayer> {
    const player = this.getPlayer(data);
    const ownsChannel = player.channels.some((channelId) => this.channels.get(channelId)?.ownerId === player._id);
    if (ownsChannel) {
      return { event: GIEvent.PlayerResponseError, payload: player, errorCode: "RELAY_UNREGISTER_CHOWNER" };
    }
    if (!player.saveSettings) {
      return { event: GIEvent.PlayerResponseInfo, payload: player, infoCode: "RELAY_INFO_UNREGISTERED" };
    }
    player.saveSettings = false;
    this.players.delete(player._id);
    this.dirty = true;
    return { event: GIEvent.PlayerResponseSuccess, payload: player, successCode: "RELAY_SUCCESS_UNREGISTER" };
  }

  joinChannel(data: PlayerJoinChannelMessage): WSMessage<GlobalIntercomPlayer>[] {
    const player = this.getPlayer(data);
    const channelName = normalizeChannel(data.channel);
    const channel = this.channels.get(channelName);
    if (!channel) {
      return [this.error(player, channelName, "RELAY_CHANNEL_UNKNOWN")];
    }
    if (!this.channelPasswordMatches(channel, data.password)) {
      return [this.error(player, channelName, "RELAY_JOIN_NOACCESS")];
    }
    if (!player.channels.includes(channel._id)) {
      player.channels.push(channel._id);
      this.markPersistentPlayerDirty(player);
    }
    return [
      { event: GIEvent.PlayerJoinChannel, payload: player, subject: channelName },
      { event: GIEvent.PlayerResponseSuccess, payload: player, subject: channelName, successCode: "RELAY_JOIN_SUCCESS" },
    ];
  }

  leaveChannel(data: PlayerLeaveChannelMessage): WSMessage<GlobalIntercomPlayer>[] {
    const player = this.getPlayer(data);
    const channelName = normalizeChannel(data.channel);
    const channel = this.channels.get(channelName);
    if (!channel) {
      return [this.error(player, channelName, "RELAY_CHANNEL_UNKNOWN")];
    }
    if (channel.ownerId === player._id) {
      return [this.error(player, channelName, "RELAY_LEAVE_OWNER")];
    }
    removeValue(player.channels, channel._id);
    this.markPersistentPlayerDirty(player);
    return [
      { event: GIEvent.PlayerResponseSuccess, payload: player, subject: channelName, successCode: "RELAY_LEAVE_SUCCESS" },
      { event: GIEvent.PlayerLeaveChannel, payload: player, subject: channelName },
    ];
  }

  createChannel(data: PlayerCreateChannelMessage): WSMessage<GlobalIntercomPlayer>[] {
    const player = this.getPlayer(data);
    const channelName = normalizeChannel(data.channel);
    if (!player.saveSettings) {
      return [this.error(player, channelName, "RELAY_CREATE_NOTREGISTERED")];
    }
    if (channelName.startsWith("global")) {
      return [this.error(player, channelName, "RELAY_CREATE_NOGLOBAL")];
    }
    if (channelName.length < 3 || channelName.length > 20) {
      return [this.error(player, channelName, "RELAY_CREATE_LENGTH")];
    }
    if (this.channels.has(channelName)) {
      return [this.error(player, channelName, "RELAY_CREATE_EXISTS")];
    }

    const channel: GlobalIntercomChannel = {
      _id: channelName,
      description: `Channel created by ${player.name}`,
      secure: Boolean(data.password),
      password: data.password ? this.hashPassword(data.password) : null,
      ownerId: player._id,
    };
    this.channels.set(channelName, channel);
    if (!player.channels.includes(channelName)) {
      player.channels.push(channelName);
    }
    this.dirty = true;
    return [
      { event: GIEvent.PlayerCreateChannel, payload: player, subject: channelName },
      {
        event: GIEvent.PlayerResponseSuccess,
        payload: player,
        subject: channelName,
        successCode: "RELAY_CREATE_SUCCESS",
      },
    ];
  }

  closeChannel(data: PlayerCloseChannelMessage): {
    responses: WSMessage<GlobalIntercomPlayer>[];
    notifications: Array<{ client: RelayClient; message: WSMessage<GlobalIntercomPlayer> }>;
  } {
    const player = this.getPlayer(data);
    const channelName = normalizeChannel(data.channel);
    const channel = this.channels.get(channelName);
    if (!channel) {
      return { responses: [this.error(player, channelName, "RELAY_CH_CLOSE_NOTEXISTS")], notifications: [] };
    }
    if (channel.ownerId !== player._id) {
      return { responses: [this.error(player, channelName, "RELAY_CH_CLOSE_NOTOWNER")], notifications: [] };
    }

    this.channels.delete(channelName);
    const notifications: Array<{ client: RelayClient; message: WSMessage<GlobalIntercomPlayer> }> = [];
    for (const otherPlayer of this.players.values()) {
      if (!otherPlayer.channels.includes(channelName)) {
        continue;
      }
      removeValue(otherPlayer.channels, channelName);
      this.markPersistentPlayerDirty(otherPlayer);
      const origins = this.playerOrigins.get(otherPlayer._id);
      if (origins && otherPlayer._id !== player._id) {
        for (const origin of origins) {
          notifications.push({ client: origin, message: this.error(otherPlayer, channelName, "RELAY_CH_CLOSED") });
        }
      }
    }
    this.dirty = true;
    return {
      responses: [
        {
          event: GIEvent.PlayerResponseSuccess,
          payload: player,
          subject: channelName,
          successCode: "RELAY_CH_CLOSE_SUCCESS",
        },
      ],
      notifications,
    };
  }

  overrideChange(data: PlayerOverrideChangeMessage): WSMessage<GlobalIntercomPlayer> {
    const player = this.getPlayer(data);
    player.override = Boolean(data.override);
    this.markPersistentPlayerDirty(player);
    return { event: GIEvent.PlayerOverrideChange, payload: player, subject: String(player.override) };
  }

  broadcastMessage(data: ChatMessage): WSMessage<GlobalIntercomPlayer> | null {
    const player = this.players.get(data.playerUID);
    const channelName = normalizeChannel(data.chatChannel);
    const channel = this.channels.get(channelName);
    if (!player || !channel || !player.channels.includes(channel._id)) {
      return {
        event: GIEvent.PlayerResponseError,
        payload: player ?? this.anonymousPlayer(data.playerUID, data.playerName),
        subject: channelName,
        errorCode: channel ? "RELAY_CHANNEL_NOTMEMBER" : "RELAY_CHANNEL_UNKNOWN",
      };
    }
    return null;
  }

  relayClients(): RelayClient[] {
    const clients = new Set<RelayClient>();
    for (const origins of this.playerOrigins.values()) {
      for (const client of origins) {
        clients.add(client);
      }
    }
    return [...clients];
  }

  private addOrigin(playerId: string, client: RelayClient): void {
    const origins = this.playerOrigins.get(playerId);
    if (origins) {
      origins.add(client);
      return;
    }
    this.playerOrigins.set(playerId, new Set([client]));
  }

  private ensureDefaultChannels(): void {
    for (const channelName of DEFAULT_CHANNELS) {
      if (!this.channels.has(channelName)) {
        this.channels.set(channelName, {
          _id: channelName,
          description: "default channel",
          secure: false,
          password: null,
          ownerId: null,
        });
        this.dirty = true;
      }
    }
  }

  private getPlayer(data: PlayerMessage): GlobalIntercomPlayer {
    const id = data.playerUID;
    let player = this.players.get(id);
    if (!player) {
      player = this.anonymousPlayer(id, data.playerName);
      this.players.set(id, player);
    } else {
      player.name = data.playerName;
    }
    return player;
  }

  private anonymousPlayer(playerUID: string, playerName: string): GlobalIntercomPlayer {
    return {
      _id: playerUID,
      id64: playerUID,
      name: playerName,
      saveSettings: false,
      channels: [],
      online: false,
      override: false,
    };
  }

  private error(player: GlobalIntercomPlayer, subject: string, errorCode: string): WSMessage<GlobalIntercomPlayer> {
    return { event: GIEvent.PlayerResponseError, payload: player, subject, errorCode };
  }

  private channelPasswordMatches(channel: GlobalIntercomChannel, password: string | undefined): boolean {
    return !channel.secure || channel.password === this.hashPassword(password ?? "");
  }

  private hashPassword(password: string): string {
    return createHmac("sha256", this.channelSecret).update(password).digest("hex");
  }

  private markPersistentPlayerDirty(player: GlobalIntercomPlayer): void {
    if (player.saveSettings) {
      this.dirty = true;
    }
  }
}

function normalizeChannel(channel: string): string {
  return (channel ?? "").trim().toLowerCase();
}

function removeValue(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}
