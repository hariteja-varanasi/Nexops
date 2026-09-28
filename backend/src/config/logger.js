'use strict';
const pino = require('pino');
const env = require('./env');

// Structured JSON logging: one line per event so Promtail/Loki can parse it.
const logger = pino({
  level: env.logLevel,
  base: { service: 'nexops-backend', version: env.version, env: env.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'password', '*.password', 'token'],
    censor: '[redacted]',
  },
});

module.exports = logger;
