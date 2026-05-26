import { env } from "node:process";
import { resolve } from "node:path";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function channelMapFromEnv(value: string | undefined): Map<string, string> {
  const channels = new Map<string, string>();
  for (const entry of (value ?? "").split(",")) {
    const [relayChannel, discordChannelId] = entry.split(":").map((part) => part?.trim());
    if (relayChannel && discordChannelId) {
      channels.set(relayChannel.toLowerCase(), discordChannelId);
    }
  }
  return channels;
}

const discordChannelIds = channelMapFromEnv(env.GIRS_DISCORD_CHANNELS);
const discordBotToken = env.GIRS_DISCORD_BOT_TOKEN;
const discordExplicitlyEnabled = booleanFromEnv(env.GIRS_DISCORD_ENABLED, false);

export const systemConfig = <const>{
  appName: env.GIRS_APP_NAME ?? env.APP_TITLE ?? env.appName ?? "Global Intercom Relay Server",
  useMongo: env.MONGODB_URI ? true : false,
  mongoURI: env.MONGODB_URI,
  host: env.GIRS_HOST ?? env.HOST ?? "0.0.0.0",
  port: numberFromEnv(env.GIRS_PORT ?? env.APP_WSS_PORT ?? env.PORT, 47015),
  persistencePath: resolve(env.GIRS_PERSISTENCE_PATH ?? env.GIRS_DATA_PATH ?? "data/relay-state.json"),
  saveIntervalMs: numberFromEnv(env.GIRS_SAVE_INTERVAL_MS, 30000),
  logLevel: env.GIRS_LOG_LEVEL ?? env.appLogLevel ?? env.APP_LOGLEVEL ?? "info",
  channelSecret: env.GIRS_CHANNEL_SECRET ?? env.SALT ?? "d3f4ul753cR3T",
  discord: {
    enabled: discordExplicitlyEnabled || Boolean(discordBotToken && discordChannelIds.size > 0),
    botToken: discordBotToken,
    channelIdsByRelayChannel: discordChannelIds,
    failureBackoffMs: numberFromEnv(env.GIRS_DISCORD_FAILURE_BACKOFF_MS, 60000),
  },
};
