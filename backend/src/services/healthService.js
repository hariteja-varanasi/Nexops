'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const env = require('../config/env');

const startedAt = Date.now();

/**
 * Liveness answers "is the process alive". It must not touch dependencies,
 * otherwise a database blip restarts every pod.
 */
function live() {
  return { status: 'UP', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) };
}

/**
 * Readiness answers "can this pod serve traffic". PostgreSQL is required.
 * Redis is not: without it NexOps is slower, not broken.
 */
async function ready() {
  let database = 'DOWN';
  try { database = (await db.ping()) ? 'UP' : 'DOWN'; } catch { database = 'DOWN'; }
  const redis = cache.isUp() ? 'UP' : 'DOWN';
  const status = database === 'UP' ? 'UP' : 'DOWN';
  return {
    status,
    database,
    redis,
    version: env.version,
    environment: env.nodeEnv,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { live, ready };
