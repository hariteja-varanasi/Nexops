'use strict';
const db = require('../config/db');
const logger = require('../config/logger');

// Audit writes must never break the request that triggered them.
async function record({ user, action, entityType, entityId, summary, metadata = {} }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id,username,action,entity_type,entity_id,summary,metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [user?.id ?? null, user?.username ?? 'system', action, entityType,
       entityId != null ? String(entityId) : null, summary, JSON.stringify(metadata)]
    );
  } catch (err) {
    logger.warn({ err: err.message, action }, 'audit write failed');
  }
}

async function recent(limit = 15) {
  const { rows } = await db.query(
    `SELECT id, username, action, entity_type, entity_id, summary, created_at
       FROM audit_logs ORDER BY created_at DESC LIMIT $1`, [limit]
  );
  return rows;
}

module.exports = { record, recent };
