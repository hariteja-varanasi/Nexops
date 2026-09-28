'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const ApiError = require('../utils/ApiError');
const audit = require('./auditService');

const CACHE_PREFIX = 'nexops:applications';

const BASE_SELECT = `
  SELECT a.id, a.name, a.description, a.version, a.repository, a.language,
         a.image_repository, a.image_tag, a.k8s_namespace, a.k8s_deployment, a.k8s_service,
         a.replicas, a.pod_count, a.cpu_millicores, a.memory_mb, a.health, a.status,
         a.git_commit, a.last_deployed_at, a.created_at, a.updated_at,
         p.id AS project_id, p.name AS project_name,
         e.id AS environment_id, e.name AS environment_name, e.slug AS environment_slug
    FROM applications a
    JOIN projects p      ON p.id = a.project_id
    JOIN environments e  ON e.id = a.environment_id`;

async function list({ environment, status, projectId, search } = {}) {
  const key = `${CACHE_PREFIX}:list:${environment || ''}:${status || ''}:${projectId || ''}:${search || ''}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;

  const where = [];
  const params = [];
  if (environment) { params.push(environment); where.push(`e.slug = $${params.length}`); }
  if (status)      { params.push(status);      where.push(`a.status = $${params.length}`); }
  if (projectId)   { params.push(projectId);   where.push(`a.project_id = $${params.length}`); }
  if (search)      { params.push(`%${search}%`); where.push(`a.name ILIKE $${params.length}`); }

  const { rows } = await db.query(
    `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.name`, params
  );
  await cache.setJson(key, rows);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE a.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Application ${id} does not exist`);
  const app = rows[0];

  const { rows: deployments } = await db.query(
    `SELECT id, version, git_commit, build_number, status, strategy,
            started_at, completed_at, duration_seconds
       FROM deployments WHERE application_id = $1
      ORDER BY started_at DESC LIMIT 10`, [id]);

  const { rows: incidents } = await db.query(
    `SELECT id, reference, title, severity, status, created_at
       FROM incidents WHERE application_id = $1 AND status <> 'RESOLVED'
      ORDER BY created_at DESC`, [id]);

  return { ...app, deployments, open_incidents: incidents };
}

async function create(data) {
  const { rows: envRows } = await db.query('SELECT namespace FROM environments WHERE id = $1', [data.environmentId]);
  if (!envRows.length) throw ApiError.badRequest('environmentId does not match a known environment');
  const namespace = envRows[0].namespace;

  const { rows } = await db.query(
    `INSERT INTO applications
      (project_id,environment_id,name,description,version,repository,language,
       image_repository,image_tag,k8s_namespace,k8s_deployment,k8s_service,replicas,pod_count)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING id`,
    [data.projectId, data.environmentId, data.name, data.description ?? null,
     data.version ?? 'v0.1.0', data.repository ?? null, data.language ?? null,
     data.imageRepository ?? `docker.io/nexops/${data.name}`,
     (data.version ?? 'v0.1.0').replace(/^v/, ''),
     namespace, data.name, `${data.name}-svc`, data.replicas ?? 1]
  );
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  await cache.invalidate('nexops:environments');
  return getById(rows[0].id);
}

async function update(id, data) {
  const fields = { name: 'name', description: 'description', version: 'version',
    repository: 'repository', replicas: 'replicas', status: 'status', health: 'health',
    imageRepository: 'image_repository', imageTag: 'image_tag' };
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(fields)) {
    if (data[key] !== undefined) { params.push(data[key]); sets.push(`${column} = $${params.length}`); }
  }
  if (!sets.length) return getById(id);
  params.push(id);
  const { rowCount } = await db.query(`UPDATE applications SET ${sets.join(', ')} WHERE id = $${params.length}`, params);
  if (!rowCount) throw ApiError.notFound(`Application ${id} does not exist`);
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  return getById(id);
}

async function remove(id) {
  const { rowCount } = await db.query('DELETE FROM applications WHERE id = $1', [id]);
  if (!rowCount) throw ApiError.notFound(`Application ${id} does not exist`);
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  await cache.invalidate('nexops:environments');
  return true;
}

/**
 * Scale an application.
 *
 * This updates the replica count NexOps tracks and writes an audit entry.
 * It does NOT talk to the Kubernetes API — the platform's desired state lives
 * in Git (see gitops/) and Argo CD reconciles it. The real path is documented
 * in docs/argocd.md; the equivalent imperative command is returned as
 * `kubectlEquivalent` so students can run it and compare.
 */
async function scale(id, replicas, user) {
  const app = await getById(id);
  await db.query('UPDATE applications SET replicas = $1, pod_count = $1 WHERE id = $2', [replicas, id]);
  await audit.record({
    user, action: 'SCALE', entityType: 'application', entityId: id,
    summary: `Scaled ${app.name} from ${app.replicas} to ${replicas} replicas`,
    metadata: { from: app.replicas, to: replicas, namespace: app.k8s_namespace },
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:environments');
  return {
    ...(await getById(id)),
    kubectlEquivalent: `kubectl -n ${app.k8s_namespace} scale deployment/${app.k8s_deployment} --replicas=${replicas}`,
  };
}

/** Restart: bumps pod identity the way a `kubectl rollout restart` would. */
async function restart(id, user) {
  const app = await getById(id);
  await db.query(
    `UPDATE applications SET status = 'RUNNING', health = 'HEALTHY', last_deployed_at = now() WHERE id = $1`, [id]
  );
  await audit.record({
    user, action: 'RESTART', entityType: 'application', entityId: id,
    summary: `Restarted ${app.name} in ${app.k8s_namespace}`,
  });
  await cache.invalidate(CACHE_PREFIX);
  return {
    ...(await getById(id)),
    kubectlEquivalent: `kubectl -n ${app.k8s_namespace} rollout restart deployment/${app.k8s_deployment}`,
  };
}

module.exports = { list, getById, create, update, remove, scale, restart };
