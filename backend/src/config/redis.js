'use strict';
const { createClient } = require('redis');
const env = require('./env');
const logger = require('./logger');

let client = null;
let connected = false;

async function connect() {
  if (client) return client;
  client = createClient({
    url: env.redisUrl,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 5000) },
  });
  client.on('error', (err) => {
    if (connected) logger.warn({ err: err.message }, 'redis error');
    connected = false;
  });
  client.on('ready', () => {
    connected = true;
    logger.info('redis connected');
  });
  try {
    await client.connect();
  } catch (err) {
    logger.warn({ err: err.message }, 'redis unavailable at startup - cache disabled');
  }
  return client;
}

function isUp() {
  return connected;
}

// Cache helpers. Every one degrades to a straight miss when Redis is down, so a
// Redis outage slows NexOps down but never takes it offline.
async function getJson(key) {
  if (!connected) return null;
  try {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache read failed');
    return null;
  }
}

async function setJson(key, value, ttlSeconds = env.cacheTtl) {
  if (!connected) return false;
  try {
    await client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (err) {
    logger.warn({ err: err.message, key }, 'cache write failed');
    return false;
  }
}

async function invalidate(prefix) {
  if (!connected) return 0;
  try {
    let removed = 0;
    for await (const key of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
      await client.del(key);
      removed += 1;
    }
    if (removed) logger.debug({ prefix, removed }, 'cache invalidated');
    return removed;
  } catch (err) {
    logger.warn({ err: err.message, prefix }, 'cache invalidation failed');
    return 0;
  }
}

async function disconnect() {
  if (client && connected) await client.quit();
}

module.exports = { connect, isUp, getJson, setJson, invalidate, disconnect };
