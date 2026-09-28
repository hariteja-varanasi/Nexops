'use strict';
require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  logLevel: process.env.LOG_LEVEL || 'info',
  version: process.env.APP_VERSION || require('../../package.json').version,

  databaseUrl: required('DATABASE_URL', 'postgresql://nexops:nexops_dev_password@localhost:5432/nexops'),
  pgSsl: process.env.PGSSL === 'true',

  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  cacheTtl: Number(process.env.CACHE_TTL_SECONDS || 30),

  jwtSecret: required('JWT_SECRET', 'change-me-in-every-environment'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS || 10),

  seedEnabled: process.env.SEED_ENABLED !== 'false',
  seedAdminUsername: process.env.SEED_ADMIN_USERNAME || 'admin',
  seedAdminPassword: process.env.SEED_ADMIN_PASSWORD || 'admin123',

  corsOrigin: (process.env.CORS_ORIGIN || '*').split(',').map((s) => s.trim()),

  prometheusUrl: process.env.PROMETHEUS_URL || '',
  lokiUrl: process.env.LOKI_URL || '',
};

// ---------------------------------------------------------------------------
// Refuse to start with a secret anyone can look up.
//
// This repository is public, so every placeholder in it — .env.example,
// values.yaml, secret.yaml — is world-readable. A JWT secret that appears in a
// public repository is not a secret: anyone can mint a token that this server
// will accept as a valid admin session.
//
// Matching one exact string was not enough, because the placeholders differ
// between files. Match the shape of a placeholder instead.
// ---------------------------------------------------------------------------
const PLACEHOLDER_PATTERNS = [
  /change[-_ ]?me/i,
  /replace[-_ ]?with/i,
  /^(changeme|secret|password|test|dev|example|placeholder|todo)$/i,
  /your[-_ ]?(secret|password|key)[-_ ]?here/i,
];

function looksLikePlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

const secretProblems = [];

if (looksLikePlaceholder(env.jwtSecret)) {
  secretProblems.push(
    'JWT_SECRET is still one of the placeholder values from this repository. ' +
      'Because the repository is public, that value is known to everyone and ' +
      'anyone could forge an admin token. Generate one: openssl rand -hex 32'
  );
} else if (env.jwtSecret.length < 32) {
  secretProblems.push(
    `JWT_SECRET is only ${env.jwtSecret.length} characters. Use at least 32: openssl rand -hex 32`
  );
}

// A seeded admin account whose password is published in the README is a public
// login. Fine while SEED_ENABLED is off, which is what production sets.
if (env.seedEnabled && env.seedAdminPassword === 'admin123') {
  secretProblems.push(
    'SEED_ADMIN_PASSWORD is still the documented demo password while seeding is ' +
      'enabled. Set SEED_ADMIN_PASSWORD, or set SEED_ENABLED=false.'
  );
}

if (env.nodeEnv === 'production' && secretProblems.length > 0) {
  throw new Error(
    `Refusing to start in production with insecure configuration:\n  - ${secretProblems.join('\n  - ')}`
  );
}

// Outside production these are warnings, not errors: a training cluster is
// supposed to boot with the demo credentials. The warning is there so nobody
// is surprised later about what those defaults mean.
if (env.nodeEnv !== 'production' && secretProblems.length > 0) {
  for (const problem of secretProblems) {
    process.emitWarning(`[nexops:config] ${problem}`, 'InsecureConfigWarning');
  }
}

module.exports = env;
module.exports.looksLikePlaceholder = looksLikePlaceholder;
