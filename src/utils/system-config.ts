import { env } from "node:process";
import { resolve } from "node:path";

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

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
};
