import { logger } from "./utils/logger";
import { systemConfig } from "./utils/system-config";
import { RelayServer } from "./relay/relay-server";

async function bootstrap() {
  logger.log(`Bootstrapping ${systemConfig.appName}`);
  logger.log({
    host: systemConfig.host,
    port: systemConfig.port,
    persistencePath: systemConfig.persistencePath,
    saveIntervalMs: systemConfig.saveIntervalMs,
    logLevel: systemConfig.logLevel,
  });

  const relayServer = new RelayServer();
  await relayServer.start();

  const shutdown = async () => {
    logger.log("Shutting down relay server");
    await relayServer.stop();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

bootstrap().catch(logger.error);
