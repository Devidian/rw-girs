import type WebSocket from "ws";

export enum GIEvent {
  BroadcastMessage = "broadcastMessage",
  DirectContactMessage = "directContactMessage",
  RegisterPlayer = "registerPlayer",
  UnregisterPlayer = "unregisterPlayer",
  PlayerOnline = "playerOnline",
  PlayerOffline = "playerOffline",
  PlayerJoinChannel = "playerJoinChannel",
  PlayerLeaveChannel = "playerLeaveChannel",
  PlayerCloseChannel = "playerCloseChannel",
  PlayerCreateChannel = "playerCreateChannel",
  PlayerOverrideChange = "playerOverrideChange",
  PlayerResponseError = "playerResponseError",
  PlayerResponseSuccess = "playerResponseSuccess",
  PlayerResponseInfo = "playerResponseInfo",
  ServerRegister = "serverRegister",
  ServerPresence = "serverPresence",
  ServerPresenceSubscribe = "serverPresenceSubscribe",
}

export interface WSMessage<T = unknown> {
  event: string;
  payload: T;
  subject?: string;
  infoCode?: string;
  successCode?: string;
  errorCode?: string;
}

export interface PlayerMessage {
  playerUID: string;
  playerName: string;
}

export interface ServerRegisterMessage {
  shortName?: string;
}

export interface ServerPresenceSubscribeMessage {
  channel: string;
}

export interface RelayServerPresence {
  name: string;
  playerCount: number;
}

export interface ServerPresenceMessage {
  channel: string;
  servers: RelayServerPresence[];
}

export interface PlayerRegisterMessage extends PlayerMessage {
  register: boolean;
}

export interface PlayerUnregisterMessage extends PlayerMessage {
  unregister: boolean;
}

export interface PlayerCreateChannelMessage extends PlayerMessage {
  channel: string;
  password?: string;
}

export interface PlayerJoinChannelMessage extends PlayerMessage {
  channel: string;
  password?: string;
}

export interface PlayerLeaveChannelMessage extends PlayerMessage {
  channel: string;
}

export interface PlayerCloseChannelMessage extends PlayerMessage {
  channel: string;
}

export interface PlayerOverrideChangeMessage extends PlayerMessage {
  override: boolean;
}

export interface ChatMessage {
  createdOn: string | Date;
  chatVersion: number;
  chatContent: string;
  chatChannel: string;
  playerName: string;
  playerUID: string;
  sourceName: string;
  sourceIP: string;
  sourceVersion: string;
  attachment?: string;
}

export interface GlobalIntercomPlayer {
  _id: string;
  id64: string;
  name: string;
  saveSettings: boolean;
  channels: string[];
  online: boolean;
  override: boolean;
}

export interface GlobalIntercomChannel {
  _id: string;
  description: string;
  secure: boolean;
  password: string | null;
  ownerId: string | null;
}

export interface PersistedRelayState {
  version: 1;
  savedAt: string;
  players: GlobalIntercomPlayer[];
  channels: GlobalIntercomChannel[];
}

export interface RelayClient extends WebSocket {
  relayId?: number;
  remoteAddress?: string;
}
