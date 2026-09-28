'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const ApiError = require('../utils/ApiError');
const audit = require('./auditService');
const { deploymentsTotal } = require('../middleware/metrics');

const CACHE_PREFIX = 'nexops:deployments';

// The CI/CD stages NexOps models. They mirror the Jenkinsfile one for one, so a
// student can line up this list against a real Jenkins run.
const PIPELINE_STAGES = [
  'Checkout', 'Install Dependencies', 'Lint', 'Unit Tests', 'SonarQube Analysis',
  'Docker Build', 'Trivy Scan', 'Push to Docker Hub', 'Update GitOps Manifest', 'Argo CD Sync',
];

const BASE_SELECT = `
  SELECT d.id, d.version, d.git_commit, d.git_branch, d.build_number, d.image_tag,
         d.strategy, d.status, d.stages, d.notes,
         d.started_at, d.completed_at, d.duration_seconds,
         a.id AS application_id, a.name AS application_name, a.k8s_namespace,
         e.id AS environment_id, e.name AS environment_name, e.slug AS environment_slug,
         u.username AS triggered_by
    FROM deployments d
    JOIN applications a  ON a.id = d.application_id
    JOIN environments e  ON e.id = d.environment_id
    LEFT JOIN users u    ON u.id = d.triggered_by`;

async function list({ environment, status, applicationId, limit = 50 } = {}) {
  const key = `${CACHE_PREFIX}:list:${environment || ''}:${status || ''}:${applicationId || ''}:${limit}`;
  const cached = await cache.getJson(key);
  if (cached) return cached;

  const where = [];
  const params = [];
  if (environment)   { params.push(environment);   where.push(`e.slug = $${params.length}`); }
  if (status)        { params.push(status);        where.push(`d.status = $${params.length}`); }
  if (applicationId) { params.push(applicationId); where.push(`d.application_id = $${params.length}`); }
  params.push(limit);

  const { rows } = await db.query(
    `${BASE_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY d.started_at DESC LIMIT $${params.length}`, params);
  await cache.setJson(key, rows, 15);
  return rows;
}

async function getById(id) {
  const { rows } = await db.query(`${BASE_SELECT} WHERE d.id = $1`, [id]);
  if (!rows.length) throw ApiError.notFound(`Deployment ${id} does not exist`);
  return rows[0];
}

/**
 * Record a deployment.
 *
 * NexOps is the system of record, not the executor. In the real flow Jenkins
 * POSTs here after each stage and Argo CD performs the cluster change. When a
 * deployment is created from the UI the stages start as PENDING and are
 * advanced through PUT /api/deployments/:id/stage.
 */
async function create(data, user) {
  const { rows: appRows } = await db.query(
    'SELECT id, name, environment_id, k8s_namespace FROM applications WHERE id = $1', [data.applicationId]);
  if (!appRows.length) throw ApiError.badRequest('applicationId does not match a known application');
  const app = appRows[0];

  const stages = PIPELINE_STAGES.map((name) => ({ name, status: 'PENDING', durationMs: 0 }));
  const { rows: nextBuild } = await db.query('SELECT COALESCE(max(build_number),1000)+1 AS n FROM deployments');

  const { rows } = await db.query(
    `INSERT INTO deployments
      (application_id,environment_id,triggered_by,version,git_commit,git_branch,
       build_number,image_tag,strategy,status,stages,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RUNNING',$10::jsonb,$11) RETURNING id`,
    [app.id, app.environment_id, user?.id ?? null, data.version, data.gitCommit ?? null,
     data.gitBranch ?? 'main', data.buildNumber ?? nextBuild[0].n,
     data.imageTag ?? data.version.replace(/^v/, ''), data.strategy ?? 'ROLLING',
     JSON.stringify(stages), data.notes ?? null]
  );

  await db.query(
    `UPDATE applications SET status='DEPLOYING', version=$1, image_tag=$2, git_commit=$3 WHERE id=$4`,
    [data.version, data.imageTag ?? data.version.replace(/^v/, ''), data.gitCommit ?? null, app.id]);

  deploymentsTotal.labels(String(app.environment_id), 'RUNNING').inc();
  await audit.record({
    user, action: 'DEPLOY', entityType: 'deployment', entityId: rows[0].id,
    summary: `Started deployment of ${app.name} ${data.version}`,
    metadata: { namespace: app.k8s_namespace, version: data.version },
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  await cache.invalidate('nexops:applications');
  return getById(rows[0].id);
}

/** Advance one pipeline stage. Jenkins calls this from a post{} block. */
async function updateStage(id, { stage, status, durationMs }, user) {
  const deployment = await getById(id);
  const stages = deployment.stages.map((s) =>
    s.name === stage ? { ...s, status, durationMs: durationMs ?? s.durationMs } : s);
  if (!stages.some((s) => s.name === stage)) {
    throw ApiError.badRequest(`Unknown stage "${stage}"`, [{ field: 'stage', message: `Expected one of: ${PIPELINE_STAGES.join(', ')}` }]);
  }
  await db.query('UPDATE deployments SET stages = $1::jsonb WHERE id = $2', [JSON.stringify(stages), id]);
  if (status === 'FAILED') await complete(id, 'FAILED', user);
  await cache.invalidate(CACHE_PREFIX);
  return getById(id);
}

async function complete(id, status, user) {
  const deployment = await getById(id);
  await db.query(
    `UPDATE deployments
        SET status = $1, completed_at = now(),
            duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))::int
      WHERE id = $2`, [status, id]);

  const appStatus = status === 'SUCCESS' ? 'RUNNING' : status === 'FAILED' ? 'FAILED' : 'RUNNING';
  const health = status === 'SUCCESS' ? 'HEALTHY' : status === 'FAILED' ? 'UNHEALTHY' : 'HEALTHY';
  await db.query(
    `UPDATE applications SET status=$1, health=$2, last_deployed_at=now() WHERE id=$3`,
    [appStatus, health, deployment.application_id]);

  deploymentsTotal.labels(String(deployment.environment_id), status).inc();
  await audit.record({
    user, action: `DEPLOY_${status}`, entityType: 'deployment', entityId: id,
    summary: `Deployment ${id} of ${deployment.application_name} finished with ${status}`,
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:dashboard');
  await cache.invalidate('nexops:applications');
  return getById(id);
}

/**
 * Roll back an application to the version of its last successful deployment.
 * Records a new ROLLED_BACK deployment so history stays append-only, matching
 * `argocd app rollback` / `kubectl rollout undo`.
 */
async function rollback(applicationId, user) {
  const { rows: previous } = await db.query(
    `SELECT version, git_commit, image_tag FROM deployments
      WHERE application_id = $1 AND status = 'SUCCESS'
      ORDER BY started_at DESC OFFSET 1 LIMIT 1`, [applicationId]);
  if (!previous.length) {
    throw ApiError.badRequest('No earlier successful deployment to roll back to');
  }
  const target = previous[0];
  const { rows: appRows } = await db.query(
    'SELECT id,name,environment_id,k8s_namespace,k8s_deployment FROM applications WHERE id=$1', [applicationId]);
  if (!appRows.length) throw ApiError.notFound(`Application ${applicationId} does not exist`);
  const app = appRows[0];

  const stages = PIPELINE_STAGES.map((name) => ({
    name,
    status: ['Argo CD Sync', 'Update GitOps Manifest'].includes(name) ? 'SUCCESS' : 'SKIPPED',
    durationMs: 0,
  }));

  const { rows } = await db.query(
    `INSERT INTO deployments
      (application_id,environment_id,triggered_by,version,git_commit,git_branch,image_tag,
       strategy,status,stages,notes,completed_at,duration_seconds)
     VALUES ($1,$2,$3,$4,$5,'main',$6,'ROLLING','ROLLED_BACK',$7::jsonb,$8,now(),12)
     RETURNING id`,
    [app.id, app.environment_id, user?.id ?? null, target.version, target.git_commit,
     target.image_tag, JSON.stringify(stages),
     `Rolled back to ${target.version} by ${user?.username ?? 'system'}`]
  );

  await db.query(
    `UPDATE applications SET version=$1, image_tag=$2, git_commit=$3,
            status='RUNNING', health='HEALTHY', last_deployed_at=now() WHERE id=$4`,
    [target.version, target.image_tag, target.git_commit, app.id]);

  deploymentsTotal.labels(String(app.environment_id), 'ROLLED_BACK').inc();
  await audit.record({
    user, action: 'ROLLBACK', entityType: 'application', entityId: app.id,
    summary: `Rolled ${app.name} back to ${target.version}`,
    metadata: { targetVersion: target.version, namespace: app.k8s_namespace },
  });
  await cache.invalidate(CACHE_PREFIX);
  await cache.invalidate('nexops:applications');
  await cache.invalidate('nexops:dashboard');

  return {
    deployment: await getById(rows[0].id),
    kubectlEquivalent: `kubectl -n ${app.k8s_namespace} rollout undo deployment/${app.k8s_deployment}`,
    argocdEquivalent: `argocd app rollback nexops-${app.k8s_namespace.replace('nexops-', '')}`,
  };
}

module.exports = { list, getById, create, updateStage, complete, rollback, PIPELINE_STAGES };
