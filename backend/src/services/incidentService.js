'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const ApiError = require('../utils/ApiError');
const audit = require('./auditService');

const CACHE_PREFIX = 'nexops:incidents';

const BASE_SELECT = `
  SELECT i.id, i.reference, i.title, i.description, i.severity, i.status,
         i.created_at, i.updated_at, i.resolved_at,
         a.id AS application_id, a.name AS application_name,
         e.name AS environment_name, e.slug AS environment_slug,
         au.username AS assigned_to_username, au.full_name AS assigned_to_name,
         cu.username AS created_by_username
    FROM incidents i
    LEFT JOIN applications a  ON a.id = i.application_id
    LEFT JOIN environments e  ON e.id = i.environment_id
    LEFT JOIN users au        ON au.id = i.assigned_to
    LEFT JOIN users cu        ON cu.id = i.created_by`;

async function list({ status, severity, applicationId } = {}) {
  const key = `${CACHE_PREFIX}:list:${status || ''}:${severity || ''}:${applicationId || ''}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;

  const where = [];
  const params = [];
  if (status)        { params.push(status);        where.push(`i.status = $${params.length}`); }
  if (severity)      { params.push(severity);      where.push(`i.severity = $${params.length}`); }
  if (applicationId) { params.push(applicationId); where.push(`i.application_id = $${params.length}`); }

  const { rows } = await db.query(
    `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY CASE i.status WHEN 'OPEN' THEN 0 WHEN 'INVESTIGATING' THEN 1 ELSE 2 END,
              CASE i.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
              i.created_at DESC`, params);
  await cache.setJson(key, rows, 15);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE i.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Incident ${id} does not exist`);
  return rows[0];
}

async function create(data, user) {
  const { rows: ref } = await db.query(
    `SELECT 'INC-' || (1000 + COALESCE(count(*),0) + 1)::text AS reference FROM incidents`);
  const { rows } = await db.query(
    `INSERT INTO incidents
      (reference,title,description,severity,status,application_id,environment_id,assigned_to,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [ref[0].reference, data.title, data.description ?? null, data.severity ?? 'LOW',
     data.status ?? 'OPEN', data.applicationId ?? null, data.environmentId ?? null,
     data.assignedTo ?? null, user?.id ?? null]
  );
  await audit.record({
    user, action: 'INCIDENT_OPEN', entityType: 'incident', entityId: rows[0].id,
    summary: `Opened ${ref[0].reference}: ${data.title}`,
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return getById(rows[0].id);
}

async function update(id, data, user) {
  const fields = { title: 'title', description: 'description', severity: 'severity',
    status: 'status', assignedTo: 'assigned_to', applicationId: 'application_id' };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(fields)) {
    if (data[key] !== undefined) { params.push(data[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (data.status === 'RESOLVED') sets.push('resolved_at = now()');
  if (data.status && data.status !== 'RESOLVED') sets.push('resolved_at = NULL');
  if (!sets.length) return getById(id);

  params.push(id);
  const { rowCount } = await db.query(`UPDATE incidents SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!rowCount) throw ApiError.notFound(`Incident ${id} does not exist`);
  await audit.record({
    user, action: 'INCIDENT_UPDATE', entityType: 'incident', entityId: id,
    summary: `Updated incident ${id}${data.status ? ` to ${data.status}` : ''}`,
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return getById(id);
}

module.exports = { list, getById, create, update };
