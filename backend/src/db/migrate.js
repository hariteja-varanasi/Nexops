'use strict';
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const logger = require('../config/logger');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  const { rows } = await pool.query('SELECT version, applied_at FROM schema_migrations ORDER BY version');
  logger.info({ migrations: rows.map((r) => r.version) }, 'schema up to date');
  return rows;
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { logger.error({ err }, 'migration failed'); process.exit(1); });
}

module.exports = migrate;
