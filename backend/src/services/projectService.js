'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const ApiError = require('../utils/ApiError');

const CACHE_PREFIX = 'nexops:projects';

const BASE_SELECT = `
  SELECT p.id, p.name, p.slug, p.description, p.repository, p.status,
         p.created_at, p.updated_at,
         u.id AS owner_id, u.full_name AS owner_name, u.username AS owner_username,
         e.id AS environment_id, e.name AS environment_name, e.slug AS environment_slug,
         (SELECT count(*)::int FROM applications a WHERE a.project_id = p.id) AS application_count,
         (SELECT count(*)::int FROM deployments d
            JOIN applications a2 ON a2.id = d.application_id
           WHERE a2.project_id = p.id) AS deployment_count
    FROM projects p
    LEFT JOIN users u        ON u.id = p.owner_id
    LEFT JOIN environments e ON e.id = p.environment_id`;

function slugify(name) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function list({ status, search } = {}) {
  const key = `${CACHE_PREFIX}:list:${status || 'all'}:${search || ''}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;

  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
  if (search) { params.push(`%${search}%`); where.push(`(p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`); }

  const { rows } = await db.query(
    `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.created_at DESC`,
    params
  );
  await cache.setJson(key, rows);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE p.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Project ${id} does not exist`);
  const project = rows[0];
  const { rows: apps } = await db.query(
    `SELECT a.id, a.name, a.version, a.status, a.health, a.pod_count, e.name AS environment_name
       FROM applications a JOIN environments e ON e.id = a.environment_id
      WHERE a.project_id = $1 ORDER BY a.name`, [id]
  );
  return { ...project, applications: apps };
}

async function create(data) {
  const slug = slugify(data.name);
  const { rows } = await db.query(
    `INSERT INTO projects (name,slug,description,owner_id,repository,environment_id,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [data.name, slug, data.description ?? null, data.ownerId ?? null,
     data.repository ?? null, data.environmentId ?? null, data.status ?? 'ACTIVE']
  );
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return getById(rows[0].id);
}

async function update(id, data) {
  const fields = { name: 'name', description: 'description', ownerId: 'owner_id',
    repository: 'repository', environmentId: 'environment_id', status: 'status' };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(fields)) {
    if (data[key] !== undefined) { params.push(data[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (data.name !== undefined) { params.push(slugify(data.name)); sets.push(`slug = $${params.length}`); }
  if (!sets.length) return getById(id);

  params.push(id);
  const { rowCount } = await db.query(
    `UPDATE projects SET ${sets.join(', ')} WHERE id = $${params.length}`, params
  );
  if (!rowCount) throw ApiError.notFound(`Project ${id} does not exist`);
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return getById(id);
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM projects WHERE id = $1', [id]);
  if (!rowCount) throw ApiError.notFound(`Project ${id} does not exist`);
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return true;
}

module.exports = { list, getById, create, update, remove };
