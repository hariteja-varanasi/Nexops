'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const audit = require('./auditService');

const CACHE_KEY = 'nexops:dashboard:stats';

/**
 * The dashboard is the single most requested endpoint, so it is the clearest
 * place to demonstrate caching: one Redis key holds the whole payload and every
 * write path calls cache.invalidate('nexops:dashboard').
 */
async function stats() {
  const cached = await cache.getJson(CACHE_KEY);
  if (cached) return { ...cached, cached: true, cacheKey: CACHE_KEY };

  const [totals, byEnv, deployStatus, recentDeploys, activity, resources] = await Promise.all([
    db.query(`
      SELECT (SELECT count(*)::int FROM projects WHERE status='ACTIVE') AS projects,
             (SELECT count(*)::int FROM applications)                   AS applications,
             (SELECT count(*)::int FROM deployments)                    AS deployments,
             (SELECT count(*)::int FROM environments)                   AS environments,
             (SELECT count(*)::int FROM incidents WHERE status<>'RESOLVED') AS open_incidents,
             (SELECT count(*)::int FROM users WHERE is_active)          AS users`),
    db.query(`
      SELECT e.name AS environment, e.slug,
             count(a.id)::int AS applications,
             COALESCE(sum(a.pod_count),0)::int AS pods
        FROM environments e LEFT JOIN applications a ON a.environment_id = e.id
       GROUP BY e.id ORDER BY e.tier`),
    db.query(`
      SELECT status, count(*)::int AS count FROM deployments
       WHERE started_at > now() - interval '30 days' GROUP BY status`),
    db.query(`
      SELECT d.id, d.version, d.status, d.build_number, d.git_commit,
             d.started_at, d.duration_seconds,
             a.name AS application_name, e.name AS environment_name, e.slug AS environment_slug
        FROM deployments d
        JOIN applications a ON a.id = d.application_id
        JOIN environments e ON e.id = d.environment_id
       ORDER BY d.started_at DESC LIMIT 8`),
    audit.recent(10),
    db.query(`
      SELECT COALESCE(sum(a.cpu_millicores),0)::int AS cpu_millicores_used,
             COALESCE(sum(a.memory_mb),0)::int      AS memory_mb_used,
             COALESCE(sum(e.cpu_cores),0)::float * 1000 AS cpu_millicores_total,
             COALESCE(sum(e.memory_gb),0)::float * 1024 AS memory_mb_total
        FROM environments e LEFT JOIN applications a ON a.environment_id = e.id`),
  ]);

  const successCount = deployStatus.rows.find((r) => r.status === 'SUCCESS')?.count ?? 0;
  const totalRecent = deployStatus.rows.reduce((sum, r) => sum + r.count, 0);
  const r = resources.rows[0];

  const payload = {
    totals: {
      ...totals.rows[0],
      // Uptime is derived from deployment outcomes over the last 30 days: the
      // share of deployments that did not end in FAILED or ROLLED_BACK.
      uptimePercent: totalRecent
        ? Number(((successCount / totalRecent) * 100).toFixed(1))
        : 100,
    },
    applicationsByEnvironment: byEnv.rows,
    deploymentStatus: deployStatus.rows,
    recentDeployments: recentDeploys.rows,
    recentActivity: activity,
    clusterResources: {
      cpu: {
        used: r.cpu_millicores_used,
        total: Math.round(r.cpu_millicores_total),
        percent: r.cpu_millicores_total ? Math.round((r.cpu_millicores_used / r.cpu_millicores_total) * 100) : 0,
        unit: 'millicores',
      },
      memory: {
        used: r.memory_mb_used,
        total: Math.round(r.memory_mb_total),
        percent: r.memory_mb_total ? Math.round((r.memory_mb_used / r.memory_mb_total) * 100) : 0,
        unit: 'MiB',
      },
    },
    generatedAt: new Date().toISOString(),
  };

  await cache.setJson(CACHE_KEY, payload);
  return { ...payload, cached: false, cacheKey: CACHE_KEY };
}

module.exports = { stats };
