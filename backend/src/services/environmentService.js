'use strict';
const db = require('../config/db');
const cache = require('../config/redis');
const ApiError = require('../utils/ApiError');

const CACHE_KEY = 'nexops:environments:list';

async function list() {
  const cached = await cache.getJson(CACHE_KEY);
  if (cached) return cached;

  const { rows } = await db.query(`
    SELECT e.id, e.name, e.slug, e.namespace, e.description, e.cluster,
           e.cpu_cores, e.memory_gb, e.is_protected, e.tier,
           count(a.id)::int                                            AS application_count,
           COALESCE(sum(a.pod_count), 0)::int                          AS running_pods,
           COALESCE(sum(a.cpu_millicores), 0)::int                     AS cpu_millicores_used,
           COALESCE(sum(a.memory_mb), 0)::int                          AS memory_mb_used,
           count(a.id) FILTER (WHERE a.status = 'RUNNING')::int        AS healthy_apps,
           count(a.id) FILTER (WHERE a.status = 'FAILED')::int         AS failed_apps
      FROM environments e
      LEFT JOIN applications a ON a.environment_id = e.id
     GROUP BY e.id
     ORDER BY e.tier`);

  const enriched = rows.map((r) => {
    const cpuCapacity = Number(r.cpu_cores) * 1000;
    const memCapacity = Number(r.memory_gb) * 1024;
    return {
      ...r,
      cpu_percent: cpuCapacity ? Math.round((r.cpu_millicores_used / cpuCapacity) * 100) : 0,
      memory_percent: memCapacity ? Math.round((r.memory_mb_used / memCapacity) * 100) : 0,
      health: r.failed_apps > 0 ? 'DEGRADED' : r.application_count === 0 ? 'EMPTY' : 'HEALTHY',
    };
  });
  await cache.setJson(CACHE_KEY, enriched);
  return enriched;
}

async function getBySlug(slug) {
  const all = await list();
  const found = all.find((e) => e.slug === slug || String(e.id) === String(slug));
  if (!found) throw ApiError.notFound(`Environment ${slug} does not exist`);
  const { rows: apps } = await db.query(
    `SELECT id, name, version, status, health, pod_count, replicas, image_repository, image_tag
       FROM applications WHERE environment_id = $1 ORDER BY name`, [found.id]
  );
  return { ...found, applications: apps };
}

module.exports = { list, getBySlug };
