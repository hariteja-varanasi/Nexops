'use strict';
const app = require('./app');
const env = require('./config/env');
const logger = require('./config/logger');
const cache = require('./config/redis');
const db = require('./config/db');

async function start() {
  await cache.connect();

  const server = app.listen(env.port, '0.0.0.0', () => {
    logger.info({ port: env.port, env: env.nodeEnv, version: env.version }, 'nexops api listening');
  });

  // Graceful shutdown: stop accepting connections, drain, then close pools.
  // Without this a rolling update drops in-flight requests.
  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      try {
        await cache.disconnect();
        await db.pool.end();
      } catch (err) {
        logger.warn({ err: err.message }, 'error during shutdown');
      }
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('forced shutdown after 10s');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled_rejection'));
}

start().catch((err) => {
  logger.error({ err }, 'failed to start');
  process.exit(1);
});
